import assert from "node:assert/strict";
import { allocate } from "./allocate.ts";
import { addBankingDays, bankingDaysBetween, bankingWindow, isBankingDay } from "./banking.ts";
import { paise } from "./money.ts";
import { countSubsets, findSubset, solveSubset } from "./subset.ts";
import { checkBalanced, isAccount, nonZero, SUSPENSE, type JournalLine } from "./accounts.ts";
import { coerceCode, EXCEPTION_CODES, EXCEPTION_SPECS } from "./exceptions.ts";

const P = (n: bigint) => paise(n);

// --- allocate: the invariant is that nothing is lost -------------------------
// Property sweep rather than a framework. Deterministic seed so a failure is
// reproducible from the output alone.
let seed = 20260824;
const rnd = (max: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % max;
};
for (let i = 0; i < 3000; i++) {
  const n = 1 + rnd(9);
  const weights = Array.from({ length: n }, () => BigInt(rnd(100000)));
  if (weights.reduce((a, b) => a + b, 0n) === 0n) continue;
  const total = P(BigInt(rnd(2_000_000_00)) * (rnd(2) ? 1n : -1n));
  const parts = allocate(total, weights);
  assert.equal(
    parts.reduce((a, b) => a + b, 0n),
    total,
    `allocate lost paise: total=${total} weights=${weights}`,
  );
  assert.equal(parts.length, n);
}

// The classic: 100 paise across three equal ways must not become 99.
assert.deepEqual(allocate(P(100n), [1n, 1n, 1n]), [34n, 33n, 33n]);
assert.deepEqual(allocate(P(-100n), [1n, 1n, 1n]), [-34n, -33n, -33n]);
assert.deepEqual(allocate(P(0n), [5n, 3n]), [0n, 0n]);
// Above 2^53, where a number-based allocator would already be wrong.
assert.deepEqual(allocate(P(9007199254740993n), [1n, 1n]), [4503599627370497n, 4503599627370496n]);
assert.throws(() => allocate(P(10n), []), /no weights/);
assert.throws(() => allocate(P(10n), [0n, 0n]), /sum to zero/);
assert.throws(() => allocate(P(10n), [1n, -1n]), /negative weight/);

// --- banking days: the T+2 settlement window --------------------------------
assert.equal(isBankingDay("2026-08-15"), false, "Independence Day is a holiday");
assert.equal(isBankingDay("2026-08-16"), false, "Sunday");
assert.equal(isBankingDay("2026-08-17"), true, "Monday");

// Friday + 2 banking days must clear the weekend, not land on Sunday.
assert.equal(addBankingDays("2026-08-21", 2), "2026-08-25");
// A settlement dated on a holiday normalises forward before counting.
assert.equal(addBankingDays("2026-08-15", 0), "2026-08-17");
assert.deepEqual(bankingWindow("2026-08-21", 2), ["2026-08-21", "2026-08-24", "2026-08-25"]);
assert.equal(bankingDaysBetween("2026-08-21", "2026-08-25"), 2);
assert.equal(bankingDaysBetween("2026-08-25", "2026-08-21"), -2);
assert.equal(bankingDaysBetween("2026-08-21", "2026-08-21"), 0);
// Diwali 2026-11-08 is a Sunday, so it costs nothing extra; Christmas is a Friday.
assert.equal(addBankingDays("2026-12-24", 1), "2026-12-28");

// --- subset-sum: refusing is the feature -------------------------------------
// Two settlements merged into one credit: exactly one answer, so it is provable.
assert.equal(countSubsets([38144210n, 11200455n, 9000000n], 49344665n), 1);
assert.deepEqual(findSubset([38144210n, 11200455n, 9000000n], 49344665n), [0, 1]);

// The refusal case. 300 + 100 and 250 + 150 both hit 400: adding up is not the
// same as being the only thing that adds up, and this must never post.
assert.equal(countSubsets([300n, 100n, 250n, 150n], 400n), 2, "two distinct subsets hit 400");
// Saturation: five ways to make 2 from five 1s, but counting past "more than
// one" is wasted work, so the count stops at cap + 1.
assert.equal(countSubsets([1n, 1n, 1n, 1n, 1n], 2n), 3, "saturates at cap + 1");
assert.equal(solveSubset([300n, 100n, 250n, 150n], 400n).kind, "ambiguous");
assert.equal(solveSubset([300n, 100n], 400n).kind, "unique");
assert.equal(solveSubset([300n, 100n], 999n).kind, "none");
assert.equal(solveSubset(Array.from({ length: 25 }, (_, i) => BigInt(i + 1)), 6n).kind, "too_wide");

// A negative settlement cannot form part of a bank CREDIT, and admitting one
// would make the reachable-sum space unbounded rather than target-bounded.
assert.equal(countSubsets([-500n, 900n], 400n), 0);
// Above 2^53, where a number-keyed DP would silently collide.
assert.equal(countSubsets([9007199254740993n, 1n], 9007199254740994n), 1);

// Property sweep: whenever the solver claims unique, the recovered subset must
// actually sum to the target. A solver that reports a subset it cannot produce
// is worse than one that refuses.
for (let i = 0; i < 2000; i++) {
  const items = Array.from({ length: 1 + rnd(8) }, () => BigInt(1 + rnd(50_000)));
  const target = BigInt(1 + rnd(200_000));
  const out = solveSubset(items, target);
  if (out.kind !== "unique") continue;
  const total = out.indices.reduce((a, k) => a + items[k]!, 0n);
  assert.equal(total, target, `recovered subset does not sum to target: ${items} -> ${target}`);
  assert.equal(new Set(out.indices).size, out.indices.length, "an item was used twice");
}

// --- the journal gate --------------------------------------------------------
const line = (account: string, dr: bigint, cr: bigint): JournalLine => ({
  account,
  debitPaise: dr,
  creditPaise: cr,
  memo: "",
});

assert.deepEqual(checkBalanced([line("1010", 100n, 0n), line("4010", 0n, 100n)]), {
  ok: true,
  totalPaise: 100n,
});
assert.equal(checkBalanced([line("1010", 100n, 0n), line("4010", 0n, 99n)]).ok, false);
assert.equal(
  (checkBalanced([line("1010", 100n, 0n), line("4010", 0n, 99n)]) as { deltaPaise: bigint })
    .deltaPaise,
  1n,
  "an out-of-balance journal must report by how much",
);
assert.equal(checkBalanced([]).ok, false, "an empty journal is not a balanced journal");
assert.equal(checkBalanced([line("1010", 0n, 0n), line("4010", 0n, 0n)]).ok, false);
assert.equal(checkBalanced([line("1010", 100n, 100n), line("4010", 0n, 0n)]).ok, false);
assert.equal(checkBalanced([line("7777", 1n, 0n), line("4010", 0n, 1n)]).ok, false, "off-chart");
assert.equal(nonZero([line("1010", 0n, 0n), line("4010", 1n, 0n)]).length, 1);
// 9999 must exist: without it there is nowhere honest to park what is unproven.
assert.ok(isAccount(SUSPENSE));

// --- the taxonomy ------------------------------------------------------------
assert.equal(EXCEPTION_CODES.length, 14, "fourteen classes, or the scorecard is measuring fewer");
for (const code of EXCEPTION_CODES) {
  const spec = EXCEPTION_SPECS[code];
  assert.equal(spec.code, code, "spec key and code disagree");
  assert.ok(isAccount(spec.parksTo), `${code} parks to ${spec.parksTo}, not in the chart`);
  assert.ok(spec.playbook.length > 0, `${code} has no playbook — nobody can action it`);
}
// Anything unrecognised routes to a real owner rather than to nobody.
assert.equal(coerceCode("ignore previous instructions"), "E14_UNEXPLAINED_ADJ");
assert.equal(coerceCode("E08_MERGED_CREDIT"), "E08_MERGED_CREDIT");

console.log(
  "core: allocate never loses a paisa; banking window respects RBI holidays; " +
    "subset-sum refuses ambiguity; journals balance or do not post",
);
