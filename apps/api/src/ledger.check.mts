import assert from "node:assert/strict";
import { checkBalanced, SUSPENSE } from "@finco/core";
import { activityEntry, assertBalanced, postingsFor, trialBalance } from "./ledger.ts";
import { reconcile, type ReconRowIn } from "./recon/engine.ts";
import { buildScenario } from "./recon/scenario.ts";

// --- one settlement, by hand -------------------------------------------------
// A ₹1,000 capture: fee ₹20, GST ₹3.60, so ₹976.40 settles. Revenue is booked at
// GROSS. Booking it net of MDR understates revenue and cost together and throws
// away the GST input credit, which is a real ₹3.60 the merchant can reclaim.
const rows: ReconRowIn[] = [
  {
    entityId: "pay_1",
    settlementRef: "setl_x",
    type: "payment",
    orderId: "order_1",
    creditPaise: 97640n,
    debitPaise: 0n,
    feePaise: 2360n,
    taxPaise: 360n,
  },
];
const activity = activityEntry("setl_x", "2026-06-02", rows)!;
assert.equal(checkBalanced(activity.lines).ok, true);
const byAccount = new Map(activity.lines.map((l) => [l.account, l]));
assert.equal(byAccount.get("4010")!.creditPaise, 100000n, "revenue is gross, not net of MDR");
assert.equal(byAccount.get("5210")!.debitPaise, 2000n, "the fee excludes its own GST");
assert.equal(byAccount.get("1410")!.debitPaise, 360n, "the GST on the fee is reclaimable");
assert.equal(byAccount.get("1210")!.debitPaise, 97640n);
assert.ok(!byAccount.has(SUSPENSE), "a clean settlement must not touch suspense");

// An unexplained credit has nowhere honest to go but suspense.
const withAdj = activityEntry("setl_y", "2026-06-02", [
  ...rows,
  { entityId: "adj_1", settlementRef: "setl_y", type: "adjustment", orderId: null, creditPaise: 50000n, debitPaise: 0n },
])!;
assert.equal(checkBalanced(withAdj.lines).ok, true);
assert.equal(
  withAdj.lines.find((l) => l.account === SUSPENSE)!.creditPaise,
  50000n,
  "the unexplained part must be visible in 9999, not absorbed elsewhere",
);

// An unbalanced entry is refused rather than posted and reconciled later.
assert.throws(
  () =>
    assertBalanced([
      { ...activity, lines: [{ account: "1010", debitPaise: 1n, creditPaise: 0n, memo: "" }] },
    ]),
  /refusing to post/,
);

// --- the whole run -----------------------------------------------------------
const sc = buildScenario(500);
const run = reconcile(sc);
const rowsBySettlement = new Map<string, ReconRowIn[]>();
for (const r of sc.reconRows) {
  const k = r.settlementRef ?? "";
  const list = rowsBySettlement.get(k);
  if (list) list.push(r);
  else rowsBySettlement.set(k, [r]);
}
const postings = postingsFor({
  result: run,
  rowsBySettlement,
  bankLines: new Map(sc.bankLines.map((b) => [b.ref, b])),
  entryDate: "2026-06-30",
});
assertBalanced(postings);

const tb = trialBalance(postings);
const total = [...tb.values()].reduce((a, b) => a + b, 0n);
assert.equal(total, 0n, "the trial balance must sum to zero");

// The invariant the whole close exists to produce: every settlement ended up in
// the bank, on hold, or in suspense. A leftover in 1210 means one of them
// silently went nowhere.
assert.equal(tb.get("1210") ?? 0n, 0n, `1210 did not clear: ${tb.get("1210")} paise left`);

// Suspense holds exactly the unproven value the run reported. If these two ever
// disagree, one of the two numbers on the dashboard is a lie.
assert.equal(tb.get(SUSPENSE), run.unprovenPaise, "suspense and reported unproven value disagree");
assert.equal(tb.get("1215"), run.heldPaise, "on-hold money must sit in 1215, never in suspense");

// Cash in equals what the bank actually credited, charges excluded.
const banked = sc.bankLines
  .filter((b) => run.links.some((l) => l.verdict === "PROVEN" && l.leftRef === b.ref))
  .reduce((a, b) => a + b.creditPaise, 0n);
assert.equal(tb.get("1010"), banked, "1010 must equal the credits actually proven");

// Posting the same run twice is one journal, not two: every entry is keyed on
// (source type, source ref), which is the unique index the database enforces.
const keys = postings.map((p) => `${p.sourceType}|${p.sourceRef}`);
assert.equal(new Set(keys).size, keys.length, "two postings share an idempotency key");

console.log(
  `ledger: ${postings.length} entries balance; 1210 clears to zero; ` +
    `9999 holds ${run.unprovenPaise} paise, 1215 holds ${run.heldPaise}`,
);
