/**
 * The forecast, backtested against held-out history.
 *   pnpm --filter @finco/core check:forecast
 *
 * A forecast nobody scored is a horoscope. So the synthetic book below is split
 * in two: the rate is fitted on the first half and then asked to predict the
 * second, which it has never seen. That is the only honest way to know whether
 * the band means anything — a model evaluated on the rows it was fitted to will
 * always look excellent and will always be lying.
 */
import assert from "node:assert/strict";
import {
  ageing,
  DOMESTIC_LAG,
  fitPropensity,
  floorCheck,
  forecast,
  INTERNATIONAL_LAG,
  lagFor,
  settlementDue,
  type PendingRow,
} from "./forecast.ts";
import { addBankingDays, bankingDaysBetween } from "./banking.ts";

/** Deterministic, so a failure is reproducible rather than a bad afternoon. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A book with a KNOWN refund rate, which is what makes the fit checkable. */
function book(days: number, trueRate: number, seed = 7): PendingRow[] {
  const r = rng(seed);
  const rows: PendingRow[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date("2026-06-01T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + d);
    const capturedOn = day.toISOString().slice(0, 10);
    for (let i = 0; i < 12; i++) {
      const amount = BigInt(50_000 + Math.floor(r() * 950_000));
      const intl = r() < 0.1;
      rows.push({
        type: "payment",
        creditPaise: amount,
        debitPaise: 0n,
        capturedOn,
        currency: intl ? "USD" : "INR",
        settlementRef: null,
      });
      if (r() < trueRate * 2) {
        // Refund half the value at twice the frequency, so the VALUE-weighted
        // rate lands on trueRate. A count-weighted fit would read double, which
        // is the bug this shape is here to catch.
        rows.push({
          type: "refund",
          creditPaise: 0n,
          debitPaise: amount / 2n,
          capturedOn,
          currency: intl ? "USD" : "INR",
          settlementRef: null,
        });
      }
    }
  }
  return rows;
}

// --- 1. the settlement calendar ----------------------------------------------
// 2026-06-05 is a Friday. Domestic T+2 must land Tuesday the 9th, not Sunday.
const friday = "2026-06-05";
assert.equal(new Date(`${friday}T00:00:00Z`).getUTCDay(), 5, "the fixture date is not a Friday");
const domestic: PendingRow = { type: "payment", creditPaise: 1n, debitPaise: 0n, currency: "INR" };
const intl: PendingRow = { type: "payment", creditPaise: 1n, debitPaise: 0n, currency: "USD" };
assert.equal(lagFor(domestic), DOMESTIC_LAG);
assert.equal(lagFor(intl), INTERNATIONAL_LAG);
assert.equal(settlementDue(friday, domestic), addBankingDays(friday, 2));
const due = settlementDue(friday, domestic);
assert.ok(new Date(`${due}T00:00:00Z`).getUTCDay() !== 0, "settled on a Sunday");
assert.ok(new Date(`${due}T00:00:00Z`).getUTCDay() !== 6, "settled on a Saturday");
assert.ok(settlementDue(friday, intl) > due, "international must settle later than domestic");

// --- 2. the fit recovers a rate it was not told ------------------------------
const TRUE = 0.06;
const history = book(40, TRUE);
const fitted = fitPropensity(history, false);
assert.ok(fitted.n >= 20, "the fixture is too small to fit; the prior would be used");
assert.ok(
  Math.abs(fitted.rate - TRUE) < 0.02,
  `fitted ${fitted.rate.toFixed(4)} is nowhere near the true ${TRUE}`,
);
assert.ok(fitted.low <= fitted.rate && fitted.rate <= fitted.high, "band does not contain its own centre");
assert.ok(fitted.low >= 0 && fitted.high <= 1, "a rate outside [0,1]");

// A thin sample must fall back to the prior with a WIDE band rather than
// reporting a confident number from four rows.
const thin = fitPropensity(history.slice(0, 6), false);
assert.equal(thin.rate, 0.03, "a six-row sample produced a fitted rate");
assert.ok(thin.high > thin.rate * 2, "the prior band is not wide enough to be honest");

// --- 3. the backtest: fit on the first half, predict the second --------------
// The held-out slice is never shown to the fit. If the band only covers the
// truth when the model has seen it, the band is decoration.
const half = Math.floor(history.length / 2);
const seen = history.slice(0, half);
const heldOut = history.slice(half);

const asOf = "2026-06-20";
const curve = forecast(heldOut, asOf, 14, seen);
const end = curve[curve.length - 1]!;

const actualGross = heldOut
  .filter((r) => r.type === "payment" && r.capturedOn && settlementDue(r.capturedOn, r) <= end.date)
  .reduce((a, r) => a + r.creditPaise, 0n);
const actualNet = (actualGross * BigInt(Math.round((1 - TRUE) * 10_000))) / 10_000n;

assert.ok(
  end.cumP10Paise <= actualNet && actualNet <= end.cumP90Paise,
  `the held-out actual ${actualNet} fell outside the band [${end.cumP10Paise}, ${end.cumP90Paise}]`,
);
assert.ok(end.cumP10Paise <= end.cumP50Paise, "p10 above p50");
assert.ok(end.cumP50Paise <= end.cumP90Paise, "p50 above p90");

// --- 4. the curve is arithmetic, not vibes -----------------------------------
assert.equal(curve.length, 14);
for (const p of curve) {
  assert.ok(p.p10Paise <= p.p50Paise && p.p50Paise <= p.p90Paise, `${p.date} band is inverted`);
  assert.ok(p.p90Paise <= p.grossPaise, `${p.date} nets MORE than it grossed`);
}
// Cumulatives are the running sum of the dailies, exactly.
let running = 0n;
for (const p of curve) {
  running += p.p50Paise;
  assert.equal(p.cumP50Paise, running, `${p.date} cumulative drifted from its own dailies`);
}
// Weekends are marked so the chart can grey them; nothing settles on one.
assert.ok(curve.some((p) => !p.bankingDay), "a fortnight with no weekend in it");

// Money already attached to a settlement is the reconciler's problem, not the
// forecaster's. Counting it here would double-count every rupee in the book.
const attached = forecast(
  heldOut.map((r) => ({ ...r, settlementRef: "setl_1" })),
  asOf,
);
assert.equal(attached[attached.length - 1]!.cumP50Paise, 0n, "settled money was forecast again");

// Money that was due yesterday has not vanished. It folds onto day one.
const overdue: PendingRow[] = [
  { type: "payment", creditPaise: 500_000n, debitPaise: 0n, capturedOn: "2026-05-01", currency: "INR", settlementRef: null },
];
assert.ok(forecast(overdue, asOf)[0]!.grossPaise > 0n, "overdue money was dropped from the curve");

// --- 5. ageing ----------------------------------------------------------------
const buckets = ageing(heldOut, asOf);
assert.equal(buckets.length, 4);
assert.equal(
  buckets.reduce((a, b) => a + b.valuePaise, 0n),
  heldOut
    .filter((r) => r.type === "payment" && !r.settlementRef)
    .reduce((a, r) => a + r.creditPaise, 0n),
  "the buckets do not account for every pending rupee",
);
// Only the first bucket is inside the settlement window; the rest are late.
assert.equal(buckets.filter((b) => b.overdue).length, 3);
assert.equal(buckets[0]!.overdue, false);
for (const b of buckets) {
  if (b.items === 0) assert.equal(b.valuePaise, 0n, `${b.key} has value but no items`);
}

// --- 6. the floor is judged on p10, not on hope ------------------------------
const covered = floorCheck(curve, end.cumP10Paise - 1n);
assert.equal(covered.breach, false);
assert.ok(covered.clearsOn, "a covered floor with no date it cleared on");

const short = floorCheck(curve, end.cumP90Paise + 1_000_000n);
assert.equal(short.breach, true);
assert.equal(short.shortfallPaise, short.floorPaise - end.cumP10Paise);

// The point of the whole exercise: a floor the optimistic line clears and the
// cautious one does not is a BREACH. If this ever flips, the page is telling
// somebody to spend money that may not arrive.
const between = floorCheck(curve, (end.cumP10Paise + end.cumP90Paise) / 2n + 1n);
assert.equal(between.breach, true, "a floor was cleared on the optimistic line");

console.log(
  `forecast: T+${DOMESTIC_LAG}/T+${INTERNATIONAL_LAG} skips weekends; ` +
    `fitted ${(fitted.rate * 100).toFixed(2)}% against a true ${(TRUE * 100).toFixed(0)}% ` +
    `from ${fitted.n} captures; held-out actual ${actualNet} inside [${end.cumP10Paise}, ${end.cumP90Paise}]; ` +
    `floor judged on p10`,
);
