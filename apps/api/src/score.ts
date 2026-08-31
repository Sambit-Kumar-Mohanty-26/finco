import { createHash } from "node:crypto";
import type { ExceptionCode } from "@finco/core";
import type { ReconcileInput, RunResult } from "./recon/engine.ts";
import { buildScenario, type Truth } from "./recon/scenario.ts";

/**
 * The scorecard.
 *
 * "It matched 94%" is a claim, not a measurement. A measurement needs a truth
 * file the engine has never seen, and the discipline this file enforces is that
 * the truth is REGENERATED from the dataset's seed at scoring time and lives
 * nowhere the engine can read. If the answers were in the database, the
 * scorecard would be measuring its own fixture.
 *
 * The number that matters is precision, and it is the one with no slack in it.
 * A recall of 0.92 means eight settlements need a person, which is a Tuesday. A
 * precision of 0.99 means one posting in a hundred is a lie in the general
 * ledger, which is a restatement. So recall has a threshold and precision has
 * an absolute: any false match at all fails the gate.
 */

export type Scorecard = {
  runHash: string;
  totalRows: number;
  matchedRows: number;
  autoMatchPct: number;
  /** Of the links we posted, how many were real. Null when no truth exists. */
  precision: number | null;
  /** Of the real links, how many we found. */
  recall: number | null;
  falseMatches: { bankRef: string; settlementRefs: string[]; tier: string; reason: string }[];
  /** Share of settled VALUE that reached a proven bank credit. */
  valueCoveragePct: number;
  unprovenPaise: string;
  exceptionF1: number | null;
  exceptionDetail: { code: string; tp: number; fp: number; fn: number; f1: number }[];
  /** Every settlement either closes or is reported. No third state. */
  identityClosurePct: number;
  /** Present only when a truth file could be regenerated. */
  measurable: boolean;
  note: string;
};

const pct = (n: number, d: number) => (d === 0 ? 100 : Math.round((n / d) * 10_000) / 100);

/**
 * A stable fingerprint of the INPUTS.
 *
 * Two runs with the same hash must produce the same scorecard; if they do not,
 * the engine is not deterministic and every other number here is unreliable.
 * Canonicalised on purpose — sorted, money as decimal strings — so that row
 * order out of Postgres or a JSON key reordering cannot change it.
 */
export function runHash(input: ReconcileInput): string {
  const h = createHash("sha256");
  h.update(`period:${input.period ?? ""}\n`);
  for (const s of [...input.settlements].sort((a, b) => a.ref.localeCompare(b.ref))) {
    h.update(`s|${s.ref}|${s.utr ?? ""}|${s.amountPaise}|${s.settledOn}|${s.onHold ? 1 : 0}\n`);
  }
  for (const r of [...input.reconRows].sort((a, b) => a.entityId.localeCompare(b.entityId))) {
    h.update(`r|${r.entityId}|${r.settlementRef ?? ""}|${r.type}|${r.creditPaise}|${r.debitPaise}\n`);
  }
  for (const b of [...input.bankLines].sort((a, b2) => a.ref.localeCompare(b2.ref))) {
    h.update(`b|${b.ref}|${b.valueDate}|${b.creditPaise}|${b.chargesPaise}|${b.narration}\n`);
  }
  for (const i of [...input.erpInvoices].sort((a, b) => a.orderReceipt.localeCompare(b.orderReceipt))) {
    h.update(`i|${i.orderReceipt}|${i.amountPaise}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

/** A link is identified by its bank ref and its sorted settlement set. */
const linkKey = (bankRef: string, refs: readonly string[]) =>
  `${bankRef}=>${[...refs].sort().join("+")}`;

/**
 * Score a finished run.
 *
 * `truth` is optional and the scorecard says so honestly when it is missing:
 * precision on a real customer's data is NOT MEASURABLE, and printing 1.000
 * there would be the single most dishonest number this system could show.
 */
export function score(input: ReconcileInput, result: RunResult, truth?: Truth): Scorecard {
  const posted = result.links.filter((l) => l.verdict === "PROVEN");
  const settledValue = input.settlements.reduce((a, s) => a + s.amountPaise, 0n);
  // On-hold money is not due yet, so counting it as uncovered would penalise
  // the engine for a gateway decision. Everything else either reached the bank
  // or did not, and "did not" is exactly what this metric is for.
  const coveredValue = result.settlements
    .filter((s) => s.disposition === "PROVEN_BANK" || s.disposition === "HELD")
    .reduce((a, s) => a + s.amountPaise, 0n);

  const closed = result.settlements.filter((s) => s.closes).length;
  const reported = new Set(result.exceptions.map((e) => e.subjectRef));
  // Closure is not "everything closed". It is "everything either closed or was
  // reported" — an unexplained settlement nobody was told about is the failure.
  const accountedFor = result.settlements.filter((s) => s.closes || reported.has(s.ref)).length;

  const base = {
    runHash: runHash(input),
    totalRows: result.totalRows,
    matchedRows: result.matchedRows,
    autoMatchPct: result.autoMatchPct,
    valueCoveragePct: settledValue === 0n ? 100 : Number((coveredValue * 10_000n) / settledValue) / 100,
    unprovenPaise: result.unprovenPaise.toString(),
    identityClosurePct: pct(accountedFor, result.settlements.length),
  };

  if (!truth) {
    return {
      ...base,
      precision: null,
      recall: null,
      falseMatches: [],
      exceptionF1: null,
      exceptionDetail: [],
      measurable: false,
      note: `precision is not measurable: no truth file exists for this dataset. ${closed} of ${result.settlements.length} settlements close internally.`,
    };
  }

  // Group by bank credit before comparing. A merged credit is ONE
  // correspondence in the truth file but several rows in match_links — one per
  // settlement — so comparing row by row would score a correct merge as several
  // false matches. The unit of truth is the credit, not the row.
  const byCredit = new Map<string, { refs: Set<string>; tier: string; reason: string }>();
  for (const l of posted) {
    const g = byCredit.get(l.leftRef) ?? { refs: new Set<string>(), tier: l.tier, reason: l.reason };
    for (const ref of l.rightRef.split(",")) g.refs.add(ref);
    byCredit.set(l.leftRef, g);
  }

  const expected = new Set(truth.links.map((t) => linkKey(t.bankRef, t.settlementRefs)));
  const falseMatches: Scorecard["falseMatches"] = [];
  let tp = 0;
  for (const [bankRef, g] of byCredit) {
    const refs = [...g.refs].sort();
    if (expected.has(linkKey(bankRef, refs))) tp += 1;
    else falseMatches.push({ bankRef, settlementRefs: refs, tier: g.tier, reason: g.reason });
  }

  // --- exception classification, per code ------------------------------------
  const seeded = new Map<string, Set<string>>();
  for (const e of truth.exceptions) {
    const set = seeded.get(e.code) ?? new Set<string>();
    set.add(e.subjectRef);
    seeded.set(e.code, set);
  }
  const found = new Map<string, Set<string>>();
  for (const e of result.exceptions) {
    const set = found.get(e.code) ?? new Set<string>();
    set.add(e.subjectRef);
    found.set(e.code, set);
  }

  const codes = [...new Set([...seeded.keys(), ...found.keys()])].sort();
  const detail = codes.map((code) => {
    const want = seeded.get(code) ?? new Set<string>();
    const got = found.get(code) ?? new Set<string>();
    let hit = 0;
    for (const ref of got) if (want.has(ref)) hit += 1;
    const fp = got.size - hit;
    const fn = want.size - hit;
    // Macro F1, so a class with three instances counts as much as one with
    // three hundred. Micro F1 would let the common codes hide a class the
    // engine never once got right.
    const precision = got.size === 0 ? (want.size === 0 ? 1 : 0) : hit / got.size;
    const recall = want.size === 0 ? 1 : hit / want.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { code, tp: hit, fp, fn, f1: Math.round(f1 * 1000) / 1000 };
  });
  const exceptionF1 =
    detail.length === 0 ? 1 : Math.round((detail.reduce((a, d) => a + d.f1, 0) / detail.length) * 1000) / 1000;

  return {
    ...base,
    precision: byCredit.size === 0 ? null : Math.round((tp / byCredit.size) * 1000) / 1000,
    recall: expected.size === 0 ? null : Math.round((tp / expected.size) * 1000) / 1000,
    falseMatches,
    exceptionF1,
    exceptionDetail: detail,
    measurable: true,
    note: `${tp} of ${byCredit.size} proven credits appear in the truth file; ${expected.size} real correspondences exist.`,
  };
}

/**
 * The truth for a synthetic dataset, regenerated from its seed.
 *
 * The dataset row stores {size, seed} and NOT the answers. Rebuilding the
 * scenario here is what keeps the truth outside anything the engine reads —
 * same generator, same seed, same answers, zero storage.
 */
export function truthFor(spec: { size: number; seed: number } | null | undefined): Truth | undefined {
  if (!spec || spec.size <= 0) return undefined;
  return buildScenario(spec.size, spec.seed).truth;
}

/** The thresholds the eval gate enforces. Numbers, not vibes. */
export const THRESHOLDS = {
  autoMatchPct: 92,
  precision: 1.0,
  falseMatches: 0,
  recall: 0.92,
  valueCoveragePct: 97,
  exceptionF1: 0.9,
  identityClosurePct: 100,
} as const;

export type GateFailure = { metric: string; got: number | null; want: number; note: string };

/** Which thresholds a scorecard misses. Empty means the gate passes. */
export function gate(card: Scorecard): GateFailure[] {
  const out: GateFailure[] = [];
  const need = (metric: keyof typeof THRESHOLDS, got: number | null, note: string) => {
    const want = THRESHOLDS[metric] as number;
    if (got === null || got < want) out.push({ metric, got, want, note });
  };
  need("autoMatchPct", card.autoMatchPct, "too much lands on a person's desk to be worth running");
  need("valueCoveragePct", card.valueCoveragePct, "too much settled value never reached a proven bank credit");
  need("identityClosurePct", card.identityClosurePct, "a settlement neither closed nor was reported");
  if (!card.measurable) return out; // the rest genuinely cannot be measured
  need("precision", card.precision, "a posting that is not in the truth file is a lie in the ledger");
  need("recall", card.recall, "real correspondences the engine never found");
  need("exceptionF1", card.exceptionF1, "exceptions are being reported under the wrong class");
  if (card.falseMatches.length > THRESHOLDS.falseMatches) {
    out.push({
      metric: "falseMatches",
      got: card.falseMatches.length,
      want: 0,
      note: `${card.falseMatches[0]!.bankRef} was posted against ${card.falseMatches[0]!.settlementRefs.join("+")} and should not have been`,
    });
  }
  return out;
}

export type { ExceptionCode };
