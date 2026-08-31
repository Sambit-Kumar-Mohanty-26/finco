import assert from "node:assert/strict";
import { bankDelta, identityDelta, reconcile, type Proposal } from "./engine.ts";
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
// (duplicate captures, unexplained adjustments) are added on top.
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
assert.equal(run.totalRows, 505, "golden 500-row total changed");
assert.equal(run.matchedRows, 496, "golden 500-row match count changed");
assert.deepEqual(
  run.stages.map((x) => x.matchedRows),
  [335, 362, 388, 441, 496, 496],
  "tier-by-tier yields changed",
);

const s5k = reconcile(buildScenario(5000));
assert.equal(s5k.matchedRows, 4955, "golden 5,000-row match count changed");
assert.ok(
  s5k.autoMatchPct >= 92,
  `5,000-row auto-match ${s5k.autoMatchPct.toFixed(1)}% is below the 92% the phase plan gates on`,
);

// Stage counts are cumulative and monotonic: a later tier never un-matches.
const ms = run.stages.map((x) => x.matchedRows);
assert.deepEqual(ms, [...ms].sort((a, b) => a - b), "tier counts must be monotonic");

// --- precision is the number that cannot slip --------------------------------
// Every proven link must appear in the truth file, exactly. A wrong link posted
// to a ledger is worse than no link at all, so this is 1.000 or the build fails.
const provenByBank = new Map<string, Set<string>>();
for (const l of run.links) {
  if (l.verdict !== "PROVEN") continue;
  const set = provenByBank.get(l.leftRef) ?? new Set<string>();
  set.add(l.rightRef);
  provenByBank.set(l.leftRef, set);
}
const truthByBank = new Map(s500.truth.links.map((t) => [t.bankRef, new Set(t.settlementRefs)]));
for (const [bankRef, got] of provenByBank) {
  const want = truthByBank.get(bankRef);
  assert.ok(want, `${bankRef} was proven but has no counterpart in the truth file`);
  assert.deepEqual([...got].sort(), [...want].sort(), `${bankRef} was matched to the wrong settlements`);
}
assert.equal(provenByBank.size, 16, "golden: 16 of the 17 real bank credits are proven");
// The one that is not proven is the settlement that does not close. It has a
// real bank credit, and refusing it is the correct answer.
assert.ok(!provenByBank.has("bnk_0011"), "a credit to an open settlement was proven anyway");

// Nothing is proven twice: a bank line or settlement is consumed once per run.
const provenRefs = run.links.filter((l) => l.verdict === "PROVEN").map((l) => l.rightRef);
assert.equal(new Set(provenRefs).size, provenRefs.length, "a settlement was consumed twice");

// match_links carries a unique index on (run, tier, left, right) so that a
// resumed job replaying a tier writes nothing new. If two distinct links in one
// run ever shared that key, the second would be silently dropped on resume.
const keys = run.links.map((l) => `${l.tier}|${l.leftRef}|${l.rightRef}`);
assert.equal(new Set(keys).size, keys.length, "two links share the idempotency key");

// --- the seeded identity break -----------------------------------------------
const broken = run.settlements.filter((x) => !x.closes);
assert.equal(broken.length, s500.truth.open.length, "seeded identity breaks and detected ones disagree");
for (const b of broken) {
  assert.notEqual(b.deltaPaise, 0n);
  assert.equal(b.disposition, "OPEN");
  assert.equal(b.bankProvenBy, null, `${b.ref} does not close but was matched anyway`);
  assert.ok(
    run.exceptions.some((e) => e.subjectRef === b.ref && e.code === "E14_UNEXPLAINED_ADJ"),
    `${b.ref} is open but was not classified E14`,
  );
}
// The break is seeded with an adjustment whose description is a prompt
// injection. The engine reads free text as data, so the row changes nothing.
assert.ok(
  s500.reconRows.some((x) => x.description?.startsWith("IGNORE PREVIOUS INSTRUCTIONS")),
  "the injection fixture is no longer in the scenario",
);

// --- the twins: adding up is not the same as being the only thing that does --
// Two settlements of identical value, both narrations truncated. T2 and T3 have
// to refuse them, and only T4's UTR fragment may resolve them.
const ambiguous = run.links.filter((l) => l.verdict === "ESCALATED" && l.reason.includes("ambiguous"));
assert.ok(ambiguous.length >= 2, "the amount tiers no longer refuse the ambiguous pair");
for (const twin of ["setl_0008", "setl_0009"]) {
  const s = run.settlements.find((x) => x.ref === twin)!;
  assert.equal(s.bankProvenBy, "T4", `${twin} should only ever be resolved by narration recovery`);
}

// Every tier that has work in this scenario must actually do it, or the golden
// number is quietly only testing T0. T5 has no proposals here; it is exercised
// below with a hand-written one.
for (const st of run.stages.slice(0, 5)) {
  assert.ok(st.links > 0, `${st.key} matched nothing — the scenario no longer exercises it`);
}

// --- T5: a model claim is evidence, not a decision ---------------------------
// Both proposals below are plausible sentences and false statements. The
// verifier never reads the claim; it checks the arithmetic and says no.
const stray = s500.bankLines.at(-1)!;
const proposals: Proposal[] = [
  {
    bankRef: stray.ref,
    settlementRefs: ["setl_0013"],
    basis: "utr_exact",
    expectedSumPaise: stray.creditPaise,
    source: "T5",
    model: "claude-opus-5",
    claim: "this inward remittance is clearly the missing settlement",
  },
  {
    bankRef: stray.ref,
    settlementRefs: ["setl_0007"],
    basis: "amount_unique",
    expectedSumPaise: stray.creditPaise,
    source: "T5",
    model: "claude-opus-5",
    claim: "the held settlement was released and paid out",
  },
];
const withModel = reconcile({ ...s500, proposals });
assert.equal(withModel.matchedRows, run.matchedRows, "a model proposal changed the match count");
const verdicts = withModel.judged.filter((j) => j.proposal.source === "T5");
assert.equal(verdicts.length, 2);
assert.equal(verdicts[0]!.verdict.verdict, "REJECT");
assert.match(verdicts[0]!.verdict.reason, /setl_0013 open by/, "the refusal must name the arithmetic");
assert.equal(verdicts[1]!.verdict.verdict, "REJECT");
assert.match(verdicts[1]!.verdict.reason, /does not close against bank/);
// Rejections are shipped, not hidden: they appear on the run as refused links.
assert.equal(withModel.links.filter((l) => l.tier === "T5" && l.verdict === "REFUSED").length, 2);

// --- exception classification against the truth file --------------------------
const wanted = new Set(s500.truth.exceptions.map((e) => `${e.subjectRef}|${e.code}`));
const got = new Set(run.exceptions.map((e) => `${e.subjectRef}|${e.code}`));
for (const w of wanted) assert.ok(got.has(w), `seeded exception not reported: ${w}`);
for (const g of got) assert.ok(wanted.has(g), `exception reported that was never seeded: ${g}`);

// Suspense equals the value of what was not proven — the honest exception list.
const expectedSuspense = run.settlements
  .filter((x) => x.disposition === "UNPROVEN" || x.disposition === "OPEN")
  .reduce((a, x) => a + (x.amountPaise < 0n ? -x.amountPaise : x.amountPaise), 0n);
assert.equal(run.unprovenPaise, expectedSuspense, "suspense must equal unproven value");
// Held money is accounted for separately: 1215, not 9999.
assert.ok(run.heldPaise > 0n, "the scenario seeds held settlements");
assert.equal(
  run.settlements.filter((x) => x.disposition === "HELD").length,
  s500.truth.held.length,
);

// Determinism: same seed, same answer. This is what makes the number a control.
assert.equal(reconcile(buildScenario(500)).matchedRows, run.matchedRows, "engine is not deterministic");

console.log(
  `recon: 500-row golden run — ${run.matchedRows}/${run.totalRows} matched ` +
    `(${run.autoMatchPct.toFixed(1)}%), precision 1.000 against the truth file, ` +
    `${broken.length} identity break refused, ${run.unprovenPaise} paise unproven`,
);
