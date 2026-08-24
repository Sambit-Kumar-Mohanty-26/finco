import type { Paise } from "./money.ts";

/**
 * Split `total` across `weights` without losing a paisa.
 *
 * Largest-remainder: floor every share, then hand the leftover paise to the
 * shares with the biggest discarded remainder. The guarantee that matters is
 * `sum(allocate(t, w)) === t` for every input — a reconciliation engine that
 * loses a paisa in a split produces exceptions that are artefacts of the
 * engine rather than the data, which is the worst kind to debug.
 *
 * There is no division operator on Paise for the same reason.
 */
export function allocate(total: Paise, weights: readonly bigint[]): Paise[] {
  if (weights.length === 0) throw new Error("allocate: no weights");
  if (weights.some((w) => w < 0n)) throw new Error("allocate: negative weight");
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("allocate: weights sum to zero");

  // Negative totals (a refund being split) allocate by magnitude, then flip,
  // so the largest-remainder rule stays symmetric around zero.
  const neg = total < 0n;
  const abs = neg ? -total : total;

  const parts = weights.map((w) => (abs * w) / sum);
  let leftover = abs - parts.reduce((a, b) => a + b, 0n);

  // Rank by discarded remainder, descending; ties go to the earlier index so
  // the same inputs always produce the same split.
  const order = weights
    .map((w, i) => ({ i, rem: (abs * w) % sum }))
    .sort((a, b) => (b.rem === a.rem ? a.i - b.i : b.rem > a.rem ? 1 : -1));

  for (let k = 0; leftover > 0n; k++, leftover--) {
    const i = order[k % order.length]!.i;
    parts[i] = parts[i]! + 1n;
  }

  return parts.map((p) => (neg ? -p : p) as Paise);
}
