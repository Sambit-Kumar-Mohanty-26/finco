import assert from "node:assert/strict";
import { bankDelta, identityDelta, reconcile } from "./engine.ts";
import { parseNarration } from "./narration.ts";
import { buildScenario } from "./scenario.ts";

// --- narration: four bank formats, plus the ones that must fail --------------
const UTR = "KKBKH1415123456";
for (const [n, want] of [
  [`NEFT CR-${UTR}-RAZORPAY SOFTWARE PVT-HDFC0000060`, "HDFC"],
  [`MMT/IMPS/${UTR}/RAZORPAY/HDFC`, "ICICI"],
  [`UTR:${UTR} RAZORPAY SOFTWA`, "AXIS"],
  [`RAZORPAY SOFTWARE PRIVATE LIMI-${UTR}`, "KOTAK"],
] as const) {
  const got = parseNarration(n);
  assert.equal(got.utr, UTR, `failed to extract from ${want} format: ${n}`);
}
assert.equal(parseNarration("NEFT CR-RAZORPAY COLLECTIONS 0012").utr, null, "must not invent a UTR");
assert.equal(parseNarration("").utr, null);

// --- I1: the fee must not be subtracted twice --------------------------------
// A payment of ₹1,000 with a ₹29 fee settles ₹971. The recon row's credit is
// ALREADY 97100, so the settlement of 97100 closes to zero.
const row = { entityId: "pay_1", settlementRef: "s", type: "payment", orderId: "o", creditPaise: 97100n, debitPaise: 0n };
assert.equal(identityDelta(97100n, [row]), 0n, "I1 closes when fee is not double-counted");
// This is the bug the callout warns about: subtracting the 2900 fee again.
assert.equal(identityDelta(97100n - 2900n, [row]), -2900n, "double-subtracting fee opens the settlement");

// --- I2: bank charges belong on the settlement side --------------------------
assert.equal(bankDelta(97100n, 0n, [97100n]), 0n);
assert.equal(bankDelta(96510n, 590n, [97100n]), 0n, "charges close the gap");
assert.equal(bankDelta(96510n, 0n, [97100n]), -590n, "ignoring charges opens it");

// --- the golden test: a fixed scenario yields a fixed result ------------------
const s500 = buildScenario(500);
// `rows` is the number of payment and refund rows requested; seeded defect rows
// (unexplained adjustments) are added on top, so the total is slightly higher.
assert.ok(s500.answerKey.totalRows >= 500, "scenario produces at least the rows asked for");
const run = reconcile(s500);

assert.equal(run.totalRows, s500.answerKey.totalRows, "engine and answer key disagree on row count");
assert.equal(
  run.matchedRows,
  run.stages.at(-1)!.matchedRows,
  "the headline count must equal the final stage — a marketing number that disagrees with the ledger is worse than none",
);
// Golden: a fixed scenario yields a fixed match count. If this moves, the
// ENGINE changed — the fixture is deterministic. Update the number only with a
// reason, never to make the test pass.
assert.equal(run.matchedRows, 437, "golden 500-row match count changed");
assert.equal(run.totalRows, 501, "golden 500-row total changed");
assert.deepEqual(
  run.stages.map((x) => x.matchedRows),
  [357, 397, 437],
  "tier-by-tier yields changed",
);

const s5k = reconcile(buildScenario(5000));
assert.equal(s5k.matchedRows, 4161, "golden 5,000-row match count changed");
assert.ok(
  s5k.autoMatchPct > 80 && s5k.autoMatchPct < 88,
  `5,000-row auto-match ${s5k.autoMatchPct.toFixed(1)}% left the 80-88% band the phase plan expects`,
);

// Stage counts are cumulative and monotonic: a later tier never un-matches.
const ms = run.stages.map((x) => x.matchedRows);
assert.deepEqual(ms, [...ms].sort((a, b) => a - b), "tier counts must be monotonic");

// Every settlement with a seeded adjustment must fail I1 by exactly that amount,
// and must never be proven against a bank credit.
const broken = run.settlements.filter((x) => !x.closes);
assert.ok(broken.length > 0, "the scenario seeds identity breaks and they must surface");
for (const b of broken) {
  assert.notEqual(b.deltaPaise, 0n);
  assert.equal(b.bankProvenBy, null, `${b.ref} does not close but was matched anyway`);
}

// Nothing is proven twice: a bank line or settlement is consumed once per run.
const provenRefs = run.links.filter((l) => l.verdict === "PROVEN").map((l) => l.rightRef);
assert.equal(new Set(provenRefs).size, provenRefs.length, "a settlement was consumed twice");

// Suspense equals the value of what was not proven — the honest exception list.
const expectedSuspense = run.settlements
  .filter((x) => x.bankProvenBy === null)
  .reduce((a, x) => a + (x.amountPaise < 0n ? -x.amountPaise : x.amountPaise), 0n);
assert.equal(run.unprovenPaise, expectedSuspense, "suspense must equal unproven value");

// Determinism: same seed, same answer. This is what makes the number a control.
assert.equal(reconcile(buildScenario(500)).matchedRows, run.matchedRows, "engine is not deterministic");

// Every tier must actually fire on the 500-row scenario, or the golden test is
// quietly only testing T0.
for (const st of run.stages) assert.ok(st.links > 0, `${st.key} matched nothing — scenario no longer exercises it`);

console.log(
  `recon: 500-row golden run — ${run.matchedRows}/${run.totalRows} matched ` +
    `(${run.autoMatchPct.toFixed(1)}%), ${broken.length} identity breaks, ` +
    `${run.unprovenPaise} paise unproven`,
);
