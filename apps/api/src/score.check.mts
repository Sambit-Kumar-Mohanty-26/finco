import assert from "node:assert/strict";
import { gate, runHash, score, THRESHOLDS, truthFor } from "./score.ts";
import { reconcile } from "./recon/engine.ts";
import { buildScenario } from "./recon/scenario.ts";

// --- the gate, at the size CI enforces per pull request -----------------------
const sc = buildScenario(5000);
const card = score(sc, reconcile(sc), sc.truth);
const failures = gate(card);
assert.deepEqual(failures, [], `the 5,000-row gate fails: ${JSON.stringify(failures)}`);

assert.equal(card.measurable, true);
assert.equal(card.precision, 1, "precision must be exactly 1.000 — a false posting is a restatement");
assert.deepEqual(card.falseMatches, [], "a link was posted that the truth file does not contain");
assert.ok(card.recall! >= THRESHOLDS.recall, `recall ${card.recall}`);
assert.ok(card.exceptionF1! >= THRESHOLDS.exceptionF1, `exception F1 ${card.exceptionF1}`);
assert.equal(card.identityClosurePct, 100, "a settlement neither closed nor was reported");

// --- precision is NOT reported when it cannot be measured ---------------------
// The dishonest failure mode here is printing 1.000 on a customer's own data,
// where no truth file exists and nothing has been verified at all.
const blind = score(sc, reconcile(sc));
assert.equal(blind.precision, null, "precision was claimed with no truth file");
assert.equal(blind.recall, null);
assert.equal(blind.measurable, false);
assert.match(blind.note, /not measurable/);
// The metrics that do not need truth still work, so a blind run is not useless.
assert.equal(blind.autoMatchPct, card.autoMatchPct);
assert.equal(blind.valueCoveragePct, card.valueCoveragePct);
assert.equal(blind.identityClosurePct, 100);
// ...and the gate still enforces what it honestly can.
assert.deepEqual(gate(blind), []);

// --- a false match is caught, and named --------------------------------------
const run = reconcile(sc);
const real = run.links.find((l) => l.verdict === "PROVEN")!;
const tampered = {
  ...run,
  links: [...run.links, { ...real, leftRef: "bnk_9999", rightRef: "setl_0000", reason: "invented" }],
};
const bad = score(sc, tampered, sc.truth);
assert.equal(bad.falseMatches.length, 1, "an invented posting was scored as correct");
assert.equal(bad.falseMatches[0]!.bankRef, "bnk_9999");
assert.ok(bad.precision! < 1);
const badGate = gate(bad);
assert.ok(badGate.some((f) => f.metric === "precision"), "precision did not fail the gate");
assert.ok(badGate.some((f) => f.metric === "falseMatches"), "false matches did not fail the gate");

// --- truth is regenerated from the seed, never stored -------------------------
const spec = { size: 5000, seed: 20260824 };
assert.deepEqual(truthFor(spec), sc.truth, "the regenerated truth differs from the scenario's own");
assert.equal(truthFor(null), undefined);
assert.equal(truthFor({ size: 0, seed: 1 }), undefined, "an uploaded dataset has no truth");
// The seed changes the AMOUNTS, not which rows are defective: the defects are
// placed by row index so the same classes are exercised at every seed. So the
// truth is stable across seeds while the data underneath it is not — which is
// what lets CI change the seed to catch an engine that has memorised one file.
const other = buildScenario(5000, 99);
assert.deepEqual(other.truth, sc.truth, "the seeded defect set should not depend on the seed");
assert.notEqual(runHash(other), card.runHash, "a different seed produced identical data");
const otherCard = score(other, reconcile(other), other.truth);
assert.deepEqual(gate(otherCard), [], "the gate fails on a different seed — the engine memorised one file");
assert.equal(otherCard.precision, 1);

// --- replay determinism -------------------------------------------------------
// The whole scorecard, not just the hash: two runs over identical inputs must
// agree on every number, or none of the numbers above mean anything.
const again = score(buildScenario(5000), reconcile(buildScenario(5000)), sc.truth);
assert.deepEqual(again, card, "a replay produced a different scorecard");

// The hash is over CANONICALISED inputs, so row order cannot change it...
const shuffled = {
  ...sc,
  settlements: [...sc.settlements].reverse(),
  reconRows: [...sc.reconRows].reverse(),
  bankLines: [...sc.bankLines].reverse(),
};
assert.equal(runHash(shuffled), card.runHash, "row order changed the run hash");
// ...but one paise anywhere must.
const nudged = {
  ...sc,
  settlements: sc.settlements.map((s, i) => (i === 0 ? { ...s, amountPaise: s.amountPaise + 1n } : s)),
};
assert.notEqual(runHash(nudged), card.runHash, "a one-paise change did not change the hash");

// --- the scale curve ----------------------------------------------------------
// Quality must not decay with volume. A matcher that only works on small files
// is a demo, and the 50,000-row point is the one that finds the O(n^2).
const curve = [50, 500, 5000, 50000].map((rows) => {
  const s = buildScenario(rows);
  const t0 = performance.now();
  const r = reconcile(s);
  const ms = performance.now() - t0;
  return { rows: r.totalRows, ms: Math.round(ms), card: score(s, r, s.truth) };
});
for (const point of curve) {
  const f = gate(point.card);
  assert.deepEqual(f, [], `the gate fails at ${point.rows} rows: ${JSON.stringify(f)}`);
  assert.equal(point.card.precision, 1, `precision slipped at ${point.rows} rows`);
}
const biggest = curve.at(-1)!;
assert.ok(biggest.ms < 30_000, `50,000 rows took ${biggest.ms}ms — the nightly gate allows 30s`);

console.log(
  `score: ` +
    curve
      .map((p) => `${p.rows}r ${p.card.autoMatchPct}% p=${p.card.precision} f1=${p.card.exceptionF1} ${p.ms}ms`)
      .join(" | "),
);
