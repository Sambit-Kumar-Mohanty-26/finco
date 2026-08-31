/**
 * Bounded integer subset-sum — the T3 pass.
 *
 * Banks merge settlements: ₹3,81,442.10 and ₹1,12,004.55 arrive as one NEFT
 * credit of ₹4,93,446.65 whose narration names neither. That is subset-sum,
 * NP-hard in general and trivial here because the candidate set is the open
 * settlements inside a two banking-day window — usually under twelve — and
 * every value is an integer number of paise.
 *
 * The important part is not solving it. It is refusing to solve it when the
 * answer is not unique. Adding up is not the same as being the only thing that
 * adds up: if two different subsets hit the same total, the match is a coin
 * flip, and a coin flip posted to a book of account is a false match that
 * nobody will ever go looking for.
 */

/**
 * Count distinct subsets summing to `target`, short-circuiting at `cap`.
 *
 * We only ever need to know: none, exactly one, or more than one. Counting past
 * "more than one" is wasted work, so every cell saturates at cap + 1.
 *
 * Non-positive items are dropped rather than rejected. A settlement that nets
 * negative (a refund-heavy day) cannot be part of a bank CREDIT, and admitting
 * negatives would make the reachable-sum space unbounded — the DP would no
 * longer terminate on the target bound.
 */
export function countSubsets(items: readonly bigint[], target: bigint, cap = 2): number {
  if (target <= 0n) return 0;
  let dp = new Map<bigint, number>([[0n, 1]]);
  for (const v of items) {
    if (v <= 0n || v > target) continue;
    const next = new Map(dp);
    for (const [s, n] of dp) {
      const t = s + v;
      if (t > target) continue;
      next.set(t, Math.min((next.get(t) ?? 0) + n, cap + 1));
    }
    dp = next;
  }
  return Math.min(dp.get(target) ?? 0, cap + 1);
}

/**
 * Indices of one subset summing to `target`, or null.
 *
 * Only meaningful once countSubsets has said the answer is unique — otherwise
 * this returns whichever subset the traversal order happens to reach first,
 * which is exactly the first-fit behaviour the tier exists to avoid.
 *
 * ponytail: plain DFS with a visited set over (index, remaining). The candidate
 * set is bounded to 24 by the caller, so a smarter search would be complexity
 * bought with no measurable return.
 */
export function findSubset(items: readonly bigint[], target: bigint): number[] | null {
  const seen = new Set<string>();
  const pick: number[] = [];

  function go(i: number, left: bigint): boolean {
    if (left === 0n) return true;
    if (i >= items.length || left < 0n) return false;
    const key = `${i}:${left}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const v = items[i]!;
    if (v > 0n && v <= left) {
      pick.push(i);
      if (go(i + 1, left - v)) return true;
      pick.pop();
    }
    return go(i + 1, left);
  }

  return go(0, target) ? [...pick] : null;
}

/** Never brute-force a wide day: past this the set is a human's problem. */
export const SUBSET_CANDIDATE_CAP = 24;

export type SubsetOutcome =
  | { kind: "none" }
  | { kind: "unique"; indices: number[] }
  | { kind: "ambiguous"; count: number }
  | { kind: "too_wide"; candidates: number };

/** The whole tier in one call: count first, recover only when unique. */
export function solveSubset(items: readonly bigint[], target: bigint): SubsetOutcome {
  if (items.length > SUBSET_CANDIDATE_CAP) {
    return { kind: "too_wide", candidates: items.length };
  }
  const n = countSubsets(items, target);
  if (n === 0) return { kind: "none" };
  if (n > 1) return { kind: "ambiguous", count: n };
  const indices = findSubset(items, target);
  // countSubsets said exactly one exists, so a miss here is a solver bug.
  if (!indices) throw new Error("solveSubset: counted one subset but found none");
  return { kind: "unique", indices };
}
