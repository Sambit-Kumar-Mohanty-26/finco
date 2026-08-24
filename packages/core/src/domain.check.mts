import assert from "node:assert/strict";
import { allocate } from "./allocate.ts";
import { addBankingDays, bankingDaysBetween, bankingWindow, isBankingDay } from "./banking.ts";
import { paise } from "./money.ts";

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

console.log("core: allocate never loses a paisa; banking window respects RBI holidays");
