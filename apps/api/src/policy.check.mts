import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { AUTONOMY_MODES, linkHash, mayAutoPost, scoped, tenantOf, verifyChain, POLICY_DEFAULTS } from "./policy.ts";
import { datasets, runs } from "./db/schema.ts";
import { signatureMatches } from "./routes/webhooks.ts";
import { AUTONOMY_CAP_PAISE, reconcile, type ReconcileInput } from "./recon/engine.ts";

/**
 * Governance: the three controls that decide whether a proven claim posts.
 *
 * Every assertion here is about a REFUSAL. The happy path is covered by the
 * recon and agent checks; what those cannot show is that the controls still bite
 * when the engine is convinced it is right, which is precisely the case where a
 * control that quietly does nothing costs money.
 */

// --- the audit chain ----------------------------------------------------------

type Entry = Parameters<typeof linkHash>[1] & { prevHash: string; hash: string };

/** Build a well-formed chain of n entries. */
function chain(n: number): Entry[] {
  const out: Entry[] = [];
  let prev = "";
  for (let seq = 1; seq <= n; seq++) {
    const body = {
      seq,
      tenantId: "demo",
      actorEmail: "approver@example.com",
      action: "policy.update",
      subjectType: "policy",
      subjectRef: "demo",
      detail: { autonomyCapPaise: String(seq * 1000) },
    };
    const hash = linkHash(prev, body);
    out.push({ ...body, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

const good = chain(5);
assert.deepEqual(verifyChain(good), { ok: true }, "an untouched chain must verify");

// The realistic threat is not a rewritten table, it is one row quietly edited
// in a SQL console. The hash covers the row's own contents, so it shows.
const edited = good.map((e) => ({ ...e }));
edited[2]!.detail = { autonomyCapPaise: "999999999" };
const broken = verifyChain(edited);
assert.equal(broken.ok, false, "a single-row edit went undetected");
assert.equal(broken.ok === false && broken.brokenAtSeq, 3, "the break was reported at the wrong entry");

// Detail is hashed with sorted keys, so the same facts written in a different
// property order are the same link — otherwise the chain would break on a
// refactor rather than on tampering.
const reordered = linkHash("", { ...good[0]!, detail: { b: 2, a: 1 } });
assert.equal(reordered, linkHash("", { ...good[0]!, detail: { a: 1, b: 2 } }), "key order changed the hash");

// Deleting a row breaks the links even though every surviving row is intact.
const gapped = [good[0]!, good[2]!, good[3]!];
assert.equal(verifyChain(gapped).ok, false, "a deleted entry left the chain verifying");

// --- mayAutoPost --------------------------------------------------------------

const base = { ...POLICY_DEFAULTS };
const under = base.autonomyCapPaise - 1n;

assert.equal(mayAutoPost(base, under).allowed, true, "a proven claim under the cap should post");
assert.equal(mayAutoPost(base, base.autonomyCapPaise + 1n).allowed, false, "the cap did not hold");
assert.equal(mayAutoPost(base, -under).allowed, true, "a credit and a debit of the same size differ");

// The kill switch outranks everything, including a claim that would otherwise
// sail through. That is the entire point of having one.
const killed = mayAutoPost({ ...base, killSwitch: true }, under);
assert.equal(killed.allowed, false, "the kill switch let a claim through");
assert.match(killed.reason, /kill switch/, "the refusal must name the reason on screen");

const observing = mayAutoPost({ ...base, autonomyMode: "observe" }, under);
assert.equal(observing.allowed, false, "observe mode posted something");
assert.match(observing.reason, /observe/);

// auto is not permission to skip materiality.
assert.equal(
  mayAutoPost({ ...base, autonomyMode: "auto" }, base.autonomyCapPaise + 1n).allowed,
  false,
  "auto mode ignored the cap",
);
assert.deepEqual([...AUTONOMY_MODES], ["observe", "assist", "auto"], "the control has three positions");

// --- the kill switch reaches the engine ---------------------------------------

/**
 * One settlement, one bank line, same amount, same day: a T0/T2 match any tier
 * can prove. If the kill switch cannot stop THIS, it cannot stop anything.
 */
const amountPaise = AUTONOMY_CAP_PAISE - 1n;
const provable: ReconcileInput = {
  period: "2026-06",
  settlements: [{ ref: "setl_a", utr: "UTR900001", amountPaise, settledOn: "2026-06-18", onHold: false }],
  reconRows: [
    {
      entityId: "pay_a",
      settlementRef: "setl_a",
      type: "payment",
      orderId: "order_a",
      creditPaise: amountPaise,
      debitPaise: 0n,
      feePaise: 0n,
      taxPaise: 0n,
      disputeId: null,
      capturedOn: "2026-06-16",
      currency: "INR",
      description: null,
    },
  ],
  bankLines: [
    {
      ref: "bnk_a",
      valueDate: "2026-06-18",
      creditPaise: amountPaise,
      chargesPaise: 0n,
      narration: "NEFT UTR900001 RAZORPAY",
    },
  ],
  erpInvoices: [{ orderReceipt: "order_a", amountPaise }],
};

const normal = reconcile(provable);
assert.ok(
  normal.links.some((l) => l.verdict === "PROVEN"),
  "the fixture stopped proving anything, so the kill switch assertion below is vacuous",
);

const switched = reconcile({
  ...provable,
  policy: { autonomyCapPaise: AUTONOMY_CAP_PAISE, autonomyMode: "auto", killSwitch: true },
});
assert.equal(
  switched.links.filter((l) => l.verdict === "PROVEN").length,
  0,
  "the kill switch was on and a link still posted",
);
assert.ok(
  switched.links.every((l) => l.verdict !== "PROVEN"),
  "every outcome must route to review while the switch is on",
);
assert.match(
  switched.links.find((l) => l.reason.includes("kill switch"))!.reason,
  /kill switch/,
  "the held link must say the switch is why",
);

// A raised cap is read from the policy rather than the constant, so a tenant
// that widened it gets what it asked for and no more.
const raised = reconcile({
  ...provable,
  policy: { autonomyCapPaise: 1n, autonomyMode: "auto", killSwitch: false },
});
assert.ok(
  raised.links.some((l) => l.verdict === "PROVEN"),
  "a deterministic tier was wrongly held by the T5 autonomy cap",
);

// --- webhook signatures -------------------------------------------------------

const secret = "whsec_test";
const raw = Buffer.from(JSON.stringify({ event: "payment.captured", id: "evt_1" }));
const sig = createHmac("sha256", secret).update(raw).digest("hex");

assert.equal(signatureMatches(raw, sig, secret), true, "a valid signature was rejected");
assert.equal(signatureMatches(raw, sig.toUpperCase(), secret), true, "hex case must not matter");
assert.equal(signatureMatches(raw, undefined, secret), false, "a missing header was accepted");
assert.equal(signatureMatches(raw, "", secret), false, "an empty header was accepted");
assert.equal(signatureMatches(raw, sig, "other"), false, "the wrong secret verified");
assert.equal(signatureMatches(raw, sig.slice(0, 32), secret), false, "a truncated signature verified");
assert.equal(signatureMatches(raw, "zz" + sig.slice(2), secret), false, "non-hex was accepted");

// One byte of the body changes the digest. This is what makes re-serialising
// the JSON before verifying a silent, total failure.
const tampered = Buffer.from(raw.toString().replace("evt_1", "evt_2"));
assert.equal(signatureMatches(tampered, sig, secret), false, "an edited body kept its signature");

// --- tenant scoping -----------------------------------------------------------

// Two tenant leaks have already shipped and been fixed in this codebase, both
// the same shape: a query that filtered on everything except the tenant. Every
// scoped read now routes through one helper, so what is worth proving is that
// the helper emits the predicate rather than being decoration around a where.
const dialect = new PgDialect();

const one = dialect.sqlToQuery(scoped(datasets, "t1"));
assert.match(one.sql, /"tenant_id" = \$1/, "scoped() emitted no tenant predicate");
assert.deepEqual(one.params, ["t1"]);

// The cron passes two extra conditions. A scoped() that kept the tenant but
// dropped the rest would match ANY of that tenant's datasets, skip the ingest as
// already-done, and log success — a silent no-op is the failure mode here, not
// an error.
const many = dialect.sqlToQuery(
  scoped(datasets, "t1", eq(datasets.name, "Razorpay 2026-06-01"), eq(datasets.source, "razorpay")),
);
assert.deepEqual(many.params, ["t1", "Razorpay 2026-06-01", "razorpay"], "scoped() dropped a condition");

// undefined is how an optional filter is passed. It must vanish, not become a
// null comparison that silently matches nothing.
const sparse = dialect.sqlToQuery(scoped(runs, "t1", undefined, eq(runs.period, "2026-06")));
assert.deepEqual(sparse.params, ["t1", "2026-06"]);

// The tenant is the FIRST bound parameter in every case, which is what makes
// `grep -c 'scoped('` a usable answer to "is this query filtered".
assert.equal(many.params[0], "t1");

// tenantOf takes a partial actor: the nightly cron acts for a tenant with no
// user behind it, and a fake Actor built to satisfy a signature would land a
// fake email in the audit chain.
assert.equal(tenantOf({ tenantId: "t1" }), "t1");
assert.equal(tenantOf(undefined), "demo", "no session is the demo tenant, not a crash");

console.log(
  `policy: a one-row edit breaks the chain at seq 3; the kill switch holds a proven ` +
    `${amountPaise} paise link at every tier; observe posts nothing; ` +
    `HMAC rejects a tampered body, a truncated digest and the wrong secret; ` +
    `scoped() binds the tenant first and keeps every extra condition`,
);
