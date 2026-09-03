import { addBankingDays, bankingDaysBetween } from "./banking.ts";

/**
 * Cash forecast — when the money already captured will actually land.
 *
 * Two questions, and the page above this answers only these two: how much cash
 * arrives over the next fortnight, and is that enough. Everything here is
 * arithmetic over rows that already exist; nothing is predicted from thin air.
 * A capture on the 3rd settles T+2, and the only real uncertainty is how much
 * of it gets refunded before it does.
 *
 * There is NO payment-method column in the gateway feed, so "method" is derived
 * the way the data actually distinguishes it: currency. A non-INR capture is an
 * international one and settles T+7 instead of T+2. Inventing a method field
 * the source does not have would make the model look more precise than its
 * inputs justify.
 *
 * The band is not decoration. p10 is the number to plan against, and it is
 * drawn heaviest on the chart for that reason: a forecast whose optimistic line
 * is the visually loudest one is an invitation to spend money that has not
 * arrived.
 */

export type PendingRow = {
  type: string;
  creditPaise: bigint;
  debitPaise: bigint;
  capturedOn?: string | null;
  currency?: string | null;
  settlementRef?: string | null;
};

/** A fitted refund rate with the band its own sample size justifies. */
export type Propensity = {
  /** Refunded value as a fraction of captured value. */
  rate: number;
  /** 80% interval. Wide when `n` is small, and honestly so. */
  low: number;
  high: number;
  /** Captures the fit is based on. Below MIN_SAMPLE the prior is used instead. */
  n: number;
};

export type ForecastPoint = {
  date: string;
  /** Gross captures due to settle on this date, before refunds. */
  grossPaise: bigint;
  p10Paise: bigint;
  p50Paise: bigint;
  p90Paise: bigint;
  /** Running totals, which is what the floor is compared against. */
  cumP10Paise: bigint;
  cumP50Paise: bigint;
  cumP90Paise: bigint;
  bankingDay: boolean;
};

export type AgeingBucket = {
  key: string;
  label: string;
  /** Inclusive bounds in banking days since capture; `null` upper is open-ended. */
  fromDays: number;
  toDays: number | null;
  items: number;
  valuePaise: bigint;
  /** Past its own settlement window, so the question is no longer "when". */
  overdue: boolean;
};

/** Domestic settles T+2, international T+7. Banking days, so Friday lands Tuesday. */
export const DOMESTIC_LAG = 2;
export const INTERNATIONAL_LAG = 7;

/**
 * Below this many captures a fitted rate is noise, so the prior is used and the
 * band is left wide. Twenty is not a statistical result; it is a calibration
 * knob, and a real book with a different refund profile should move it.
 */
const MIN_SAMPLE = 20;
const PRIOR_RATE = 0.03; // ~3% of captured value refunded, typical Indian retail

/**
 * Refunds arrive early or not at all. A capture from six weeks ago is far less
 * likely to be refunded now than yesterday's, so the fitted rate decays with
 * cohort age. The half-life is the knob that wants tuning against a real book.
 */
const REFUND_HALF_LIFE_DAYS = 21;

const isInternational = (r: PendingRow): boolean => (r.currency ?? "INR") !== "INR";

export const lagFor = (r: PendingRow): number =>
  isInternational(r) ? INTERNATIONAL_LAG : DOMESTIC_LAG;

/** Multiply paise by a fraction without ever leaving integer arithmetic. */
const scale = (v: bigint, f: number): bigint => {
  const bp = BigInt(Math.round(Math.max(0, Math.min(1, f)) * 1_000_000));
  return (v * bp) / 1_000_000n;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Fit the refund rate from the rows themselves.
 *
 * Value-weighted, not count-weighted: one refunded four-lakh order matters more
 * to a cash forecast than forty refunded two-hundred-rupee ones, and a count
 * based rate hides exactly that.
 */
export function fitPropensity(rows: readonly PendingRow[], international = false): Propensity {
  let captured = 0n;
  let refunded = 0n;
  let n = 0;
  for (const r of rows) {
    if (isInternational(r) !== international) continue;
    if (r.type === "payment") {
      captured += r.creditPaise;
      n += 1;
    } else if (r.type === "refund") {
      refunded += r.debitPaise > 0n ? r.debitPaise : r.creditPaise;
    }
  }
  if (n < MIN_SAMPLE || captured === 0n) {
    return { rate: PRIOR_RATE, low: 0, high: PRIOR_RATE * 3, n };
  }
  const rate = clamp01(Number(refunded) / Number(captured));
  // Normal approximation on a proportion. 1.2816 is the two-sided 80% z, which
  // is what makes the band p10..p90 rather than an unlabelled fuzz.
  const se = Math.sqrt(Math.max(rate * (1 - rate), 1e-9) / n);
  return { rate, low: clamp01(rate - 1.2816 * se), high: clamp01(rate + 1.2816 * se), n };
}

/** The date a capture is expected to settle. */
export function settlementDue(capturedOn: string, r: PendingRow): string {
  return addBankingDays(capturedOn, lagFor(r));
}

const isBankingDate = (iso: string): boolean => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

const pending = (r: PendingRow): boolean =>
  r.type === "payment" && !r.settlementRef && Boolean(r.capturedOn) && r.creditPaise > 0n;

/**
 * The fortnight curve.
 *
 * A row is pending when it is a capture with no settlement reference — money
 * taken from a customer that has not yet been netted into a payout. Rows already
 * attached to a settlement are the reconciler's problem, not the forecaster's.
 *
 * Dates before `asOf` are folded into the first day rather than dropped: money
 * that was due yesterday and has not arrived is still money you are waiting on,
 * and silently discarding it would flatter the curve.
 *
 * `history` exists so the backtest can fit on one slice and predict another. In
 * production it is the same rows, which is the honest default: the refund rate
 * this book actually runs at, not one borrowed from a different merchant.
 */
export function forecast(
  rows: readonly PendingRow[],
  asOf: string,
  days = 14,
  history: readonly PendingRow[] = rows,
): ForecastPoint[] {
  const dom = fitPropensity(history, false);
  const intl = fitPropensity(history, true);

  const horizon: string[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(`${asOf}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + d);
    horizon.push(day.toISOString().slice(0, 10));
  }
  const last = horizon[horizon.length - 1]!;

  const gross = new Map<string, bigint>();
  const band = new Map<string, { lo: bigint; mid: bigint; hi: bigint }>();
  for (const d of horizon) {
    gross.set(d, 0n);
    band.set(d, { lo: 0n, mid: 0n, hi: 0n });
  }

  for (const r of rows) {
    if (!pending(r)) continue;
    let due = settlementDue(r.capturedOn!, r);
    if (due < asOf) due = asOf; // overdue money is still money you are owed
    if (due > last) continue;

    const p = isInternational(r) ? intl : dom;
    // A cohort that has aged past the refund window is close to certain money.
    const age = Math.max(0, bankingDaysBetween(r.capturedOn!, asOf));
    const decay = Math.exp(-age / REFUND_HALF_LIFE_DAYS);

    gross.set(due, (gross.get(due) ?? 0n) + r.creditPaise);
    const b = band.get(due)!;
    // More refunds means less cash, so the HIGH refund rate produces the LOW
    // cash line. Getting this the wrong way round is the whole failure mode.
    b.lo += scale(r.creditPaise, 1 - p.high * decay);
    b.mid += scale(r.creditPaise, 1 - p.rate * decay);
    b.hi += scale(r.creditPaise, 1 - p.low * decay);
  }

  let cLo = 0n;
  let cMid = 0n;
  let cHi = 0n;
  return horizon.map((date) => {
    const b = band.get(date)!;
    cLo += b.lo;
    cMid += b.mid;
    cHi += b.hi;
    return {
      date,
      grossPaise: gross.get(date) ?? 0n,
      p10Paise: b.lo,
      p50Paise: b.mid,
      p90Paise: b.hi,
      cumP10Paise: cLo,
      cumP50Paise: cMid,
      cumP90Paise: cHi,
      bankingDay: isBankingDate(date),
    };
  });
}

export const BUCKETS: readonly { key: string; label: string; from: number; to: number | null }[] = [
  { key: "current", label: "In window (0–2 days)", from: 0, to: 2 },
  { key: "d3_7", label: "3–7 days", from: 3, to: 7 },
  { key: "d8_30", label: "8–30 days", from: 8, to: 30 },
  { key: "d30p", label: "Over 30 days", from: 31, to: null },
];

/**
 * Unsettled captures by age.
 *
 * Anything past its own settlement lag is overdue by definition — a domestic
 * capture eight days old should have landed six days ago — and an overdue
 * bucket deep-links into the exception queue, because at that age the question
 * stops being "when" and becomes "what went wrong".
 */
export function ageing(rows: readonly PendingRow[], asOf: string): AgeingBucket[] {
  const out: AgeingBucket[] = BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    fromDays: b.from,
    toDays: b.to,
    items: 0,
    valuePaise: 0n,
    overdue: b.from > DOMESTIC_LAG,
  }));

  for (const r of rows) {
    if (!pending(r)) continue;
    const age = Math.max(0, bankingDaysBetween(r.capturedOn!, asOf));
    const b = out.find((x) => age >= x.fromDays && (x.toDays === null || age <= x.toDays));
    if (!b) continue;
    b.items += 1;
    b.valuePaise += r.creditPaise;
  }
  return out;
}

export type FloorVerdict = {
  floorPaise: bigint;
  /** The cautious line, which is the only one worth planning against. */
  expectedPaise: bigint;
  breach: boolean;
  shortfallPaise: bigint;
  /** The first date the cautious cumulative clears the floor; null if never. */
  clearsOn: string | null;
};

/**
 * Does the fortnight cover the floor?
 *
 * Judged on p10, deliberately. A floor met only by the optimistic line is not
 * met — the point of a floor is that missing it is expensive, so the comparison
 * uses the number that still holds when refunds run high.
 */
export function floorCheck(
  curve: readonly ForecastPoint[],
  floorPaise: bigint,
): FloorVerdict {
  const end = curve[curve.length - 1];
  const expected = end?.cumP10Paise ?? 0n;
  const clears = curve.find((p) => p.cumP10Paise >= floorPaise) ?? null;
  const breach = expected < floorPaise;
  return {
    floorPaise,
    expectedPaise: expected,
    breach,
    shortfallPaise: breach ? floorPaise - expected : 0n,
    clearsOn: clears?.date ?? null,
  };
}
