import {
  bankingWindow,
  coerceCode,
  EXCEPTION_SPECS,
  solveSubset,
  SUBSET_CANDIDATE_CAP,
  type ExceptionCode,
} from "@finco/core";
import { parseNarration } from "./narration.ts";

/**
 * Deterministic reconciliation, T0 to T5.
 *
 * Pure functions over plain objects: no database, no clock, no IO, no network.
 * That is what makes the golden test possible — the same dataset must always
 * produce the same match count, and a run whose result depends on when it ran
 * is not a control. The model tier (T5) is no exception: proposals are handed
 * in already fetched, so replaying a run costs nothing and cannot drift.
 *
 * The engine never "decides". Every link it emits carries an arithmetic
 * identity that closed to zero paise, or it is not emitted. Where the numbers
 * add up but not uniquely, the verdict is ESCALATED and nothing is posted —
 * adding up is not the same as being the only thing that adds up.
 */

export type Verdict = "PROVEN" | "ESCALATED" | "REFUSED";
export type Tier = "T0" | "T1" | "T2" | "T3" | "T4" | "T5";

export const TIERS: readonly Tier[] = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;

/**
 * Below this, an identity break is absorbed to gateway fees rather than parked.
 *
 * Razorpay's MDR rounds per payment, so a settlement of a few hundred rows
 * drifts by single paise in a consistent direction. Parking a two-paisa
 * variance as a blocking exception buries the ₹4,000 one that matters. The
 * threshold is the build plan's ₹500; the drift it absorbs is typically under
 * a rupee, and the absorbed amount is always posted, never discarded.
 */
export const MATERIALITY_PAISE = 50_000n;

export type SettlementIn = {
  ref: string;
  utr: string | null;
  amountPaise: bigint;
  settledOn: string; // YYYY-MM-DD
  onHold: boolean;
};

export type ReconRowIn = {
  entityId: string;
  settlementRef: string | null;
  type: string;
  orderId: string | null;
  creditPaise: bigint;
  debitPaise: bigint;
  feePaise?: bigint;
  taxPaise?: bigint;
  disputeId?: string | null;
  capturedOn?: string | null;
  currency?: string | null;
  /** Free text from the gateway. Attacker-reachable: data, never instruction. */
  description?: string | null;
};

export type BankLineIn = {
  ref: string;
  valueDate: string; // YYYY-MM-DD
  creditPaise: bigint;
  chargesPaise: bigint;
  narration: string;
};

export type ErpInvoiceIn = { orderReceipt: string; amountPaise: bigint };

export type Link = {
  tier: Tier;
  verdict: Verdict;
  leftType: "bank_line";
  leftRef: string;
  rightType: "settlement";
  rightRef: string;
  amountPaise: bigint;
  deltaPaise: bigint;
  reason: string;
};

/** What the engine concluded about one settlement. Every one gets exactly one. */
export type Disposition =
  /** A bank credit was proved against it. */
  | "PROVEN_BANK"
  /** On hold: no bank credit is expected, so it parks in 1215 rather than 9999. */
  | "HELD"
  /** It closes against its own rows, but no bank credit could be proved. */
  | "UNPROVEN"
  /** It does not even close against its own rows. Nothing may be matched to it. */
  | "OPEN";

export type SettlementResult = {
  ref: string;
  amountPaise: bigint;
  /** I1: settlement amount minus (credits - debits). Zero means it closes. */
  deltaPaise: bigint;
  /** Non-zero only when the drift was under materiality and posted to 5210. */
  absorbedPaise: bigint;
  closes: boolean;
  disposition: Disposition;
  /** Set once a bank credit is proven against it. */
  bankProvenBy: Tier | null;
  bankRef: string | null;
  rows: number;
  matchedRows: number;
  note: string;
};

/**
 * A claim, from a regex or from a model. Not a decision — the verifier decides.
 *
 * `expectedSumPaise` forces the proposer to commit to a number. That is a small
 * trick with a large payoff: it makes an error detectable rather than merely
 * plausible, and the delta between their arithmetic and ours is a per-run
 * diagnostic instead of a silent miss.
 */
export type Proposal = {
  bankRef: string;
  settlementRefs: string[];
  basis: "utr_exact" | "utr_partial" | "amount_unique" | "amount_subset" | "narration_entity";
  expectedSumPaise: bigint;
  source: Tier;
  /** Free text from whoever proposed. Never parsed, only displayed. */
  claim?: string;
  model?: string;
};

export type VerifierVerdict = {
  verdict: "ACCEPT" | "REJECT" | "ESCALATE";
  reason: string;
  deltaPaise: bigint;
  /** How far the proposer's own arithmetic was from ours. */
  proposerDeltaPaise: bigint;
};

export type Judged = { proposal: Proposal; verdict: VerifierVerdict };

export type EngineException = {
  code: ExceptionCode;
  /** What the exception is about: a settlement ref, bank ref or entity id. */
  subjectType: "settlement" | "bank_line" | "recon_row";
  subjectRef: string;
  amountPaise: bigint;
  parksTo: string;
  autoResolvable: boolean;
  reason: string;
  /** The date the money became visible, for ageing the suspense balance. */
  asOf: string;
  evidence: Record<string, unknown>;
};

export type Stage = {
  key: string;
  tier: Tier | "GATE";
  label: string;
  detail: string;
  /** Cumulative matched rows after this tier. */
  matchedRows: number;
  links: number;
  escalated: number;
};

export type RunResult = {
  totalRows: number;
  matchedRows: number;
  unprovenPaise: bigint;
  heldPaise: bigint;
  absorbedPaise: bigint;
  autoMatchPct: number;
  stages: Stage[];
  settlements: SettlementResult[];
  links: Link[];
  exceptions: EngineException[];
  /** Every proposal seen, with the verdict — including the rejected ones. */
  judged: Judged[];
};

export type ReconcileInput = {
  settlements: SettlementIn[];
  reconRows: ReconRowIn[];
  bankLines: BankLineIn[];
  erpInvoices: ErpInvoiceIn[];
  /** YYYY-MM. Drives the cross-period and cutoff classes. */
  period?: string;
  /** T5 claims, already fetched and cached by the caller. */
  proposals?: Proposal[];
};

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const abs = (v: bigint) => (v < 0n ? -v : v);

/**
 * I1 — a settlement closes against its own recon rows.
 *
 *   settlement.amount = SUM(row.credit) - SUM(row.debit)
 *
 * `credit` is ALREADY NET OF FEE. Subtracting fee here is the single most
 * common recon bug in Indian merchant books: it understates every settlement by
 * roughly 2.9% of gross, so nothing closes and the entire run parks in suspense.
 */
export function identityDelta(settlementAmount: bigint, rows: ReconRowIn[]): bigint {
  const credits = sum(rows.map((r) => r.creditPaise));
  const debits = sum(rows.map((r) => r.debitPaise));
  return settlementAmount - (credits - debits);
}

/**
 * I2 — a bank credit closes against the settlements sharing its UTR.
 *
 *   bank.credit = SUM(settlement.amount) - bank_charges
 */
export function bankDelta(
  bankCredit: bigint,
  charges: bigint,
  settlementAmounts: bigint[],
): bigint {
  return bankCredit - (sum(settlementAmounts) - charges);
}

// ---------------------------------------------------------------------------

type State = ReturnType<typeof buildState>;

/**
 * The mutable run state, plus the verifier bound to it.
 *
 * One object rather than six loose maps because the verifier and every tier
 * have to agree on exactly which settlements and bank lines are still open. A
 * tier that consults a stale copy would happily consume the same credit twice.
 */
function buildState(input: ReconcileInput) {
  const { settlements, reconRows, bankLines, erpInvoices } = input;

  const rowsBySettlement = new Map<string, ReconRowIn[]>();
  for (const r of reconRows) {
    const k = r.settlementRef ?? "";
    const list = rowsBySettlement.get(k);
    if (list) list.push(r);
    else rowsBySettlement.set(k, [r]);
  }

  const invoiceByReceipt = new Map(erpInvoices.map((i) => [i.orderReceipt, i]));
  const settlementByRef = new Map(settlements.map((s) => [s.ref, s]));
  const bankByRef = new Map(bankLines.map((b) => [b.ref, b]));

  const results = new Map<string, SettlementResult>();
  const links: Link[] = [];
  const exceptions: EngineException[] = [];
  const judged: Judged[] = [];
  const consumedSettlements = new Set<string>();
  const consumedBankLines = new Set<string>();

  /** Every settlement gets an entry below, so a miss here is a programming error. */
  const resultFor = (ref: string): SettlementResult => {
    const r = results.get(ref);
    if (!r) throw new Error(`no settlement result for ${ref}`);
    return r;
  };

  return {
    input,
    settlements,
    reconRows,
    bankLines,
    rowsBySettlement,
    invoiceByReceipt,
    settlementByRef,
    bankByRef,
    results,
    resultFor,
    links,
    exceptions,
    judged,
    consumedSettlements,
    consumedBankLines,
  };
}

/**
 * The verifier. The model's reasoning is discarded; only its claim is tested.
 *
 * This is the actual product. It is deliberately the only path to a posting,
 * whether the proposal came from a regex, from a subset solver or from Claude:
 * one gate means there is exactly one place to audit, and no tier can grow its
 * own private notion of "close enough".
 */
export function verify(state: State, p: Proposal): VerifierVerdict {
  const bank = state.bankByRef.get(p.bankRef);
  if (!bank) {
    return { verdict: "REJECT", reason: `no bank line ${p.bankRef}`, deltaPaise: 0n, proposerDeltaPaise: 0n };
  }
  if (state.consumedBankLines.has(p.bankRef)) {
    return { verdict: "REJECT", reason: "bank line already consumed", deltaPaise: 0n, proposerDeltaPaise: 0n };
  }
  if (p.settlementRefs.length === 0) {
    return { verdict: "REJECT", reason: "no settlements proposed", deltaPaise: 0n, proposerDeltaPaise: 0n };
  }
  if (new Set(p.settlementRefs).size !== p.settlementRefs.length) {
    return { verdict: "REJECT", reason: "the same settlement was proposed twice", deltaPaise: 0n, proposerDeltaPaise: 0n };
  }

  const setls: SettlementIn[] = [];
  for (const ref of p.settlementRefs) {
    const s = state.settlementByRef.get(ref);
    if (!s) {
      return { verdict: "REJECT", reason: `no settlement ${ref}`, deltaPaise: 0n, proposerDeltaPaise: 0n };
    }
    if (state.consumedSettlements.has(ref)) {
      return { verdict: "REJECT", reason: `${ref} already consumed`, deltaPaise: 0n, proposerDeltaPaise: 0n };
    }
    // Each settlement must itself close against its recon rows. Matching a bank
    // credit to a settlement whose own rows disagree proves nothing at all.
    const r = state.resultFor(ref);
    if (!r.closes) {
      return {
        verdict: "REJECT",
        reason: `${ref} open by ${r.deltaPaise} paise`,
        deltaPaise: r.deltaPaise,
        proposerDeltaPaise: 0n,
      };
    }
    setls.push(s);
  }

  const total = sum(setls.map((s) => s.amountPaise));
  const proposerDelta = p.expectedSumPaise - total;
  const delta = bankDelta(bank.creditPaise, bank.chargesPaise, setls.map((s) => s.amountPaise));
  if (delta !== 0n) {
    return {
      verdict: "REJECT",
      reason: `sum ${total} does not close against bank ${bank.creditPaise} (out by ${delta})`,
      deltaPaise: delta,
      proposerDeltaPaise: proposerDelta,
    };
  }

  // Uniqueness, but only where the basis is an amount.
  //
  // An exact UTR is a key: the bank and the gateway are naming the same
  // transfer, and no arithmetic coincidence can make that untrue. An amount, a
  // fuzzy fragment or an entity name is not a key, and there uniqueness is the
  // whole guarantee — no other combination of unconsumed settlements in the
  // window may produce the same total, or the match is a coin flip.
  if (p.basis === "utr_exact") {
    return {
      verdict: "ACCEPT",
      reason: "exact UTR, identity closes to zero",
      deltaPaise: 0n,
      proposerDeltaPaise: proposerDelta,
    };
  }

  // A truncated UTR is a key with its tail missing. The verifier re-derives the
  // evidence itself rather than believing the proposer: a ten-character prefix
  // of a bank reference, present verbatim in the narration, plus an identity
  // that closes to zero paise. Without this, a merchant whose bank truncates
  // narrations could never be reconciled at all, because the amount is
  // ambiguous by construction and the fragment is the only thing that is not.
  if (p.basis === "utr_partial" && p.settlementRefs.length === 1) {
    const only = setls[0]!;
    if (narrationSupportsUtr(bank.narration, only.utr)) {
      return {
        verdict: "ACCEPT",
        reason: `narration carries a ${UTR_FRAGMENT_MIN}+ character prefix of ${only.utr}`,
        deltaPaise: 0n,
        proposerDeltaPaise: proposerDelta,
      };
    }
  }

  const candidates = openInWindow(state, bank);
  const outcome = solveSubset(
    candidates.map((s) => s.amountPaise),
    bank.creditPaise + bank.chargesPaise,
  );
  if (outcome.kind === "ambiguous") {
    return {
      verdict: "ESCALATE",
      reason: `ambiguous: ${outcome.count > 2 ? "more than two" : "two"} distinct subsets hit the target`,
      deltaPaise: 0n,
      proposerDeltaPaise: proposerDelta,
    };
  }
  if (outcome.kind === "too_wide") {
    return {
      verdict: "ESCALATE",
      reason: `candidate set too wide (${outcome.candidates} open settlements in the window)`,
      deltaPaise: 0n,
      proposerDeltaPaise: proposerDelta,
    };
  }

  return {
    verdict: "ACCEPT",
    reason: `identity closes to zero on ${p.basis}`,
    deltaPaise: 0n,
    proposerDeltaPaise: proposerDelta,
  };
}

/** Unconsumed, closing, non-held settlements whose T..T+2 window covers this line. */
function openInWindow(state: State, bank: BankLineIn): SettlementIn[] {
  return state.settlements.filter((s) => {
    if (state.consumedSettlements.has(s.ref) || s.onHold) return false;
    if (!state.resultFor(s.ref).closes) return false;
    return bankingWindow(s.settledOn, 2).includes(bank.valueDate);
  });
}

/** Post an accepted proposal: one link per settlement, both sides consumed. */
function accept(state: State, p: Proposal, tier: Tier, reason: string) {
  for (const ref of p.settlementRefs) {
    const s = state.settlementByRef.get(ref)!;
    state.links.push({
      tier,
      verdict: "PROVEN",
      leftType: "bank_line",
      leftRef: p.bankRef,
      rightType: "settlement",
      rightRef: ref,
      amountPaise: s.amountPaise,
      deltaPaise: 0n,
      reason,
    });
    state.consumedSettlements.add(ref);
    const r = state.resultFor(ref);
    r.bankProvenBy = tier;
    r.bankRef = p.bankRef;
    r.disposition = "PROVEN_BANK";
  }
  state.consumedBankLines.add(p.bankRef);
}

/** Record a proposal the verifier would not accept. Rejections are shipped, not hidden. */
function refuse(state: State, p: Proposal, tier: Tier, v: VerifierVerdict) {
  state.links.push({
    tier,
    verdict: v.verdict === "ESCALATE" ? "ESCALATED" : "REFUSED",
    leftType: "bank_line",
    leftRef: p.bankRef,
    rightType: "settlement",
    rightRef: p.settlementRefs.join(","),
    amountPaise: state.bankByRef.get(p.bankRef)?.creditPaise ?? 0n,
    deltaPaise: v.deltaPaise,
    reason: v.reason,
  });
}

/**
 * How much a model claim may post on its own authority.
 *
 * The verifier answers whether a claim is TRUE. This answers a different
 * question — whether being true is enough to post without a person — and the
 * two must not be conflated. Below materiality an autonomous posting is
 * cheaper to make than to review; above it, a proven claim still gets a
 * signature, because the cost of being wrong is no longer a rounding error.
 * Deterministic tiers are exempt: their reasoning is auditable line by line.
 */
export const AUTONOMY_CAP_PAISE = MATERIALITY_PAISE;

/** Route a proposal through the gate and record whichever way it went. */
function judge(state: State, p: Proposal, tier: Tier): VerifierVerdict {
  let v = verify(state, p);
  const credit = state.bankByRef.get(p.bankRef)?.creditPaise ?? 0n;
  if (tier === "T5" && v.verdict === "ACCEPT" && credit >= AUTONOMY_CAP_PAISE) {
    v = {
      ...v,
      verdict: "ESCALATE",
      reason: `${v.reason} — proven, but ${credit} paise is at or above the ${AUTONOMY_CAP_PAISE} paise autonomy cap, so a person signs`,
    };
  }
  state.judged.push({ proposal: p, verdict: v });
  if (v.verdict === "ACCEPT") accept(state, p, tier, `${p.basis}: ${v.reason}`);
  else refuse(state, p, tier, v);
  return v;
}

// ---------------------------------------------------------------------------

/**
 * Levenshtein distance, capped.
 *
 * Only ever asked whether a truncated narration fragment is within a couple of
 * edits of a real UTR, so the full matrix is never needed and the early exit
 * keeps a 50,000-row run honest.
 */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      best = Math.min(best, row[j]!);
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length]! <= max;
}

/**
 * The shortest narration fragment the verifier will treat as key evidence.
 *
 * Ten characters of a bank reference is roughly 36^10 of space; a collision
 * between two settlements in one three-day window is not a risk worth a
 * threshold knob. Below ten it is a guess, and guesses go to the amount path.
 */
export const UTR_FRAGMENT_MIN = 10;

/** Does the narration contain a prefix of this UTR long enough to be a key? */
function narrationSupportsUtr(narration: string, utr: string | null): boolean {
  if (!utr) return false;
  const u = utr.toUpperCase();
  const re = new RegExp(`[A-Z0-9]{${UTR_FRAGMENT_MIN},32}`, "g");
  for (const t of narration.toUpperCase().match(re) ?? []) {
    if (u.startsWith(t) || t.startsWith(u)) return true;
  }
  return false;
}

/**
 * T4 — narration normalisation and fuzzy UTR recovery, as PROPOSALS.
 *
 * The build plan has T4 model-assisted. It is a regex and an edit distance
 * here, and that is the stronger version of the same idea: a proposal is only
 * worth what the verifier says it is worth, so the cheapest proposer that
 * clears the gate wins. The model tier still exists (T5) for the residual this
 * cannot reach, and both go through exactly the same gate.
 */
export function proposeFromNarration(state: State): Proposal[] {
  const out: Proposal[] = [];
  for (const b of state.bankLines) {
    if (state.consumedBankLines.has(b.ref)) continue;
    // Longest alphanumeric run of UTR shape — what a truncated narration leaves.
    const tokens = (b.narration.toUpperCase().match(/[A-Z0-9]{8,22}/g) ?? []).sort(
      (x, y) => y.length - x.length,
    );
    if (tokens.length === 0) continue;

    const candidates = openInWindow(state, b).filter((s) => {
      if (!s.utr) return false;
      const u = s.utr.toUpperCase();
      return tokens.some(
        (t) => u.startsWith(t.slice(0, 10)) || t.startsWith(u.slice(0, 10)) || withinEdits(t, u, 2),
      );
    });
    if (candidates.length !== 1) continue;

    const s = candidates[0]!;
    out.push({
      bankRef: b.ref,
      settlementRefs: [s.ref],
      basis: "utr_partial",
      expectedSumPaise: s.amountPaise,
      source: "T4",
      claim: `narration fragment ${tokens[0]} resolves to ${s.utr}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * Typed exceptions, derived from evidence rather than from a leftover count.
 *
 * "Unmatched: 312 rows" is an abdication. A code implies an owner, an action
 * and an SLA, which is the difference between a list and a queue somebody can
 * actually work.
 */
function classify(state: State, period: string): EngineException[] {
  const out: EngineException[] = [];
  const periodStart = `${period}-01`;
  const periodEnd = `${period}-31`;
  const push = (
    code: ExceptionCode,
    subjectType: EngineException["subjectType"],
    subjectRef: string,
    amountPaise: bigint,
    reason: string,
    asOf: string,
    evidence: Record<string, unknown> = {},
  ) => {
    const spec = EXCEPTION_SPECS[coerceCode(code)];
    out.push({
      code: spec.code,
      subjectType,
      subjectRef,
      amountPaise: abs(amountPaise),
      parksTo: spec.parksTo,
      autoResolvable: spec.autoResolvable,
      reason,
      asOf,
      evidence,
    });
  };

  // --- settlement level ------------------------------------------------------
  for (const s of state.settlements) {
    const r = state.resultFor(s.ref);
    if (s.onHold) {
      push("E05_SETTLEMENT_ON_HOLD", "settlement", s.ref, s.amountPaise,
        "on hold: no bank credit is expected", s.settledOn, { settledOn: s.settledOn });
      continue;
    }
    if (r.absorbedPaise !== 0n) {
      push("E02_FEE_ROUNDING", "settlement", s.ref, r.absorbedPaise,
        `identity drift of ${r.absorbedPaise} paise, under materiality, absorbed to 5210`,
        s.settledOn, { deltaPaise: r.absorbedPaise.toString() });
    }
    if (r.disposition === "OPEN") {
      push("E14_UNEXPLAINED_ADJ", "settlement", s.ref, r.deltaPaise,
        `does not close against its own rows: open by ${r.deltaPaise} paise`,
        s.settledOn, { deltaPaise: r.deltaPaise.toString(), rows: r.rows });
    } else if (r.disposition === "UNPROVEN") {
      // It closes internally but nothing in the bank statement proves it.
      const near = state.bankLines.filter(
        (b) => !state.consumedBankLines.has(b.ref) && bankingWindow(s.settledOn, 2).includes(b.valueDate),
      );
      push("E07_UTR_TRUNCATED", "settlement", s.ref, s.amountPaise,
        "closes internally, but no bank credit could be proved against it",
        s.settledOn, { openBankLinesInWindow: near.map((b) => b.ref) });
    }
    if (s.settledOn > periodEnd) {
      push("E13_PERIOD_CUTOFF", "settlement", s.ref, s.amountPaise,
        "captured inside the period, settles after it", s.settledOn, {});
    }
  }

  // --- bank line level -------------------------------------------------------
  for (const b of state.bankLines) {
    if (state.consumedBankLines.has(b.ref)) continue;
    if (b.creditPaise <= 0n) continue;
    const candidates = openInWindow(state, b);
    const outcome = solveSubset(candidates.map((s) => s.amountPaise), b.creditPaise + b.chargesPaise);
    const parsed = parseNarration(b.narration);
    // The narration is fine and names a real settlement — the settlement is the
    // problem. Calling this a UTR defect would send it to the wrong owner and
    // hide the actual break, which is the failure mode a typed queue exists to
    // prevent.
    const named = parsed.utr ? state.settlements.find((s) => s.utr === parsed.utr) : undefined;
    if (named && !state.resultFor(named.ref).closes) {
      push("E14_UNEXPLAINED_ADJ", "bank_line", b.ref, b.creditPaise,
        `credits ${named.ref}, which is open by ${state.resultFor(named.ref).deltaPaise} paise`,
        b.valueDate, { narration: b.narration, settlementRef: named.ref });
    } else if (outcome.kind === "ambiguous" || candidates.length > 1) {
      push("E08_MERGED_CREDIT", "bank_line", b.ref, b.creditPaise,
        outcome.kind === "ambiguous"
          ? "two or more distinct subsets of open settlements hit this credit"
          : "credit does not equal any single open settlement",
        b.valueDate, {
          narration: b.narration,
          candidates: candidates.map((s) => ({ ref: s.ref, amountPaise: s.amountPaise.toString() })),
          solver: outcome.kind,
        });
    } else {
      push("E07_UTR_TRUNCATED", "bank_line", b.ref, b.creditPaise,
        parsed.utr
          ? "a UTR was extracted but matches no open settlement"
          : "no UTR could be extracted from the narration",
        b.valueDate, { narration: b.narration, parsed });
    }
  }

  // --- row level -------------------------------------------------------------
  const paymentsByOrder = new Map<string, ReconRowIn[]>();
  for (const r of state.reconRows) {
    if (r.type !== "payment" || !r.orderId) continue;
    const list = paymentsByOrder.get(r.orderId);
    if (list) list.push(r);
    else paymentsByOrder.set(r.orderId, [r]);
  }

  for (const r of state.reconRows) {
    const asOf = r.capturedOn ?? periodStart;
    if (r.disputeId) {
      if (r.debitPaise > 0n) {
        push("E03_DISPUTE_DEBIT", "recon_row", r.entityId, r.debitPaise,
          `dispute ${r.disputeId} deducted`, asOf, { disputeId: r.disputeId });
      } else {
        push("E04_DISPUTE_REVERSAL", "recon_row", r.entityId, r.creditPaise,
          `credit adjustment against dispute ${r.disputeId}`, asOf, { disputeId: r.disputeId });
      }
      continue;
    }
    if (r.entityId.startsWith("trf_")) {
      push("E12_ROUTE_NETTING", "recon_row", r.entityId, r.debitPaise + r.creditPaise,
        "route transfer nets against the settlement", asOf, {});
      continue;
    }
    if (r.entityId.startsWith("setlod_")) {
      push("E06_INSTANT_SETTLEMENT_FEE", "recon_row", r.entityId, r.debitPaise + r.creditPaise,
        "instant settlement fee outside standard MDR", asOf, {});
      continue;
    }
    if (r.currency && r.currency !== "INR") {
      push("E11_FX_VARIANCE", "recon_row", r.entityId, r.creditPaise,
        `settled in INR against a ${r.currency} booking`, asOf, { currency: r.currency });
      continue;
    }
    if (r.type === "refund" && r.capturedOn && r.capturedOn < periodStart) {
      push("E01_CROSS_PERIOD_REFUND", "recon_row", r.entityId, r.debitPaise,
        `refunds a payment captured on ${r.capturedOn}, before this period`, asOf, {});
      continue;
    }
    if (r.type === "payment" && r.orderId) {
      const same = paymentsByOrder.get(r.orderId) ?? [];
      if (same.length > 1 && same[0] !== r) {
        push("E10_DUPLICATE_CAPTURE", "recon_row", r.entityId, r.creditPaise,
          `a second capture on order ${r.orderId} for the same amount`, asOf,
          { siblings: same.map((x) => x.entityId) });
        continue;
      }
      if (!state.invoiceByReceipt.has(r.orderId)) {
        push("E09_ORPHAN_PAYMENT", "recon_row", r.entityId, r.creditPaise,
          `no ERP invoice for order ${r.orderId}: revenue cannot be recognised`, asOf, {});
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

export type StagedYield = { stage: Stage; links: Link[] };

/**
 * The run, one tier at a time.
 *
 * A generator rather than one call so the worker can commit after every tier
 * and a run killed by a mid-flight deploy resumes from the last committed one.
 * Recomputing the earlier tiers on resume is deliberate: the engine is pure and
 * a 5,000-row pass costs milliseconds, so replaying is cheaper and far simpler
 * than checkpointing the intermediate state — and it cannot diverge.
 */
export function* reconcileStaged(input: ReconcileInput): Generator<StagedYield, RunResult> {
  const state = buildState(input);
  const period = input.period ?? "2026-06";
  const { settlements, bankLines } = state;

  // ---- GATE: prove each settlement against its own rows (I1) ----------------
  // Runs first because every later tier refuses to consume a settlement that
  // does not close internally.
  for (const s of settlements) {
    const rows = state.rowsBySettlement.get(s.ref) ?? [];
    const delta = identityDelta(s.amountPaise, rows);
    const absorbed = delta !== 0n && abs(delta) <= MATERIALITY_PAISE ? delta : 0n;
    const closes = delta === 0n || absorbed !== 0n;
    // A row is matched only if its order also exists in the ERP register —
    // otherwise revenue would be recognised from the payment, not the invoice.
    const matchedRows = rows.filter(
      (r) => r.type !== "payment" || (r.orderId != null && state.invoiceByReceipt.has(r.orderId)),
    ).length;
    state.results.set(s.ref, {
      ref: s.ref,
      amountPaise: s.amountPaise,
      deltaPaise: delta,
      absorbedPaise: absorbed,
      closes,
      disposition: !closes ? "OPEN" : s.onHold ? "HELD" : "UNPROVEN",
      bankProvenBy: null,
      bankRef: null,
      rows: rows.length,
      matchedRows,
      note: delta === 0n
        ? ""
        : absorbed !== 0n
          ? `drift of ${delta} paise absorbed to 5210`
          : `open by ${delta} paise`,
    });
  }

  const stages: Stage[] = [];
  const emit = (tier: Tier, label: string, detail: string, before: number): StagedYield => {
    const mine = state.links.filter((l) => l.tier === tier);
    const stage: Stage = {
      key: tier,
      tier,
      label,
      detail,
      matchedRows: matchedRowCount(state),
      links: mine.filter((l) => l.verdict === "PROVEN").length,
      escalated: mine.filter((l) => l.verdict !== "PROVEN").length,
    };
    stages.push(stage);
    return { stage, links: state.links.slice(before) };
  };

  // ---- T0: exact key join on UTR -------------------------------------------
  let mark = 0;
  for (const b of bankLines) {
    const { utr, format } = parseNarration(b.narration);
    if (!utr) continue;
    const group = settlements.filter((s) => s.utr === utr && !state.consumedSettlements.has(s.ref));
    if (group.length === 0) continue;
    judge(
      state,
      {
        bankRef: b.ref,
        settlementRefs: group.map((s) => s.ref),
        basis: "utr_exact",
        expectedSumPaise: sum(group.map((s) => s.amountPaise)),
        source: "T0",
        claim: `narration parsed as ${format}`,
      },
      "T0",
    );
  }
  yield emit("T0", "T0 · exact key join", "UTR, settlement id, order id", mark);

  // ---- T1: the settlement UTR is in the narration but the parser missed it --
  mark = state.links.length;
  for (const b of bankLines) {
    if (state.consumedBankLines.has(b.ref)) continue;
    const hay = b.narration.toUpperCase();
    const group = settlements.filter(
      (s) => s.utr && hay.includes(s.utr.toUpperCase()) && !state.consumedSettlements.has(s.ref),
    );
    if (group.length === 0) continue;
    judge(
      state,
      {
        bankRef: b.ref,
        settlementRefs: group.map((s) => s.ref),
        // Still an exact key: the parser failed, the UTR did not.
        basis: "utr_exact",
        expectedSumPaise: sum(group.map((s) => s.amountPaise)),
        source: "T1",
        claim: "UTR present verbatim inside an unparseable narration",
      },
      "T1",
    );
  }
  yield emit("T1", "T1 · identity close", "I1 per settlement, then I2 on the bank credit", mark);

  // ---- T2: exact amount inside the T to T+2 banking window ------------------
  mark = state.links.length;
  for (const b of bankLines) {
    if (state.consumedBankLines.has(b.ref)) continue;
    const target = b.creditPaise + b.chargesPaise;
    const candidates = openInWindow(state, b).filter((s) => s.amountPaise === target);
    if (candidates.length === 0) continue;
    judge(
      state,
      {
        bankRef: b.ref,
        settlementRefs: [candidates[0]!.ref],
        basis: "amount_unique",
        expectedSumPaise: target,
        source: "T2",
        claim: `exact amount within T+2 of ${candidates[0]!.settledOn}`,
      },
      "T2",
    );
  }
  yield emit("T2", "T2 · amount and banking window", "exact amount within T to T+2, unique solution required", mark);

  // ---- T3: bounded subset-sum, unique solution required --------------------
  mark = state.links.length;
  for (const b of bankLines) {
    if (state.consumedBankLines.has(b.ref)) continue;
    const target = b.creditPaise + b.chargesPaise;
    const candidates = openInWindow(state, b);
    if (candidates.length < 2) continue;
    const outcome = solveSubset(candidates.map((s) => s.amountPaise), target);
    if (outcome.kind === "none") continue;
    if (outcome.kind === "too_wide") {
      state.links.push({
        tier: "T3",
        verdict: "ESCALATED",
        leftType: "bank_line",
        leftRef: b.ref,
        rightType: "settlement",
        rightRef: "",
        amountPaise: b.creditPaise,
        deltaPaise: 0n,
        reason: `candidate set too wide: ${outcome.candidates} open settlements, cap is ${SUBSET_CANDIDATE_CAP}`,
      });
      continue;
    }
    const refs =
      outcome.kind === "unique"
        ? outcome.indices.map((i) => candidates[i]!.ref)
        : candidates.map((s) => s.ref);
    judge(
      state,
      {
        bankRef: b.ref,
        settlementRefs: refs,
        basis: "amount_subset",
        expectedSumPaise: target,
        source: "T3",
        claim: `${refs.length} settlements merged into one credit`,
      },
      "T3",
    );
  }
  yield emit("T3", "T3 · merged credits", "bounded integer subset-sum, unique solution required", mark);

  // ---- T4: narration recovery, proposed and then verified -------------------
  mark = state.links.length;
  for (const p of proposeFromNarration(state)) judge(state, p, "T4");
  yield emit("T4", "T4 · narration recovery", "fuzzy UTR from a truncated narration, gated by the verifier", mark);

  // ---- T5: model proposals, handed in already fetched ----------------------
  mark = state.links.length;
  for (const p of input.proposals ?? []) judge(state, { ...p, source: "T5" }, "T5");
  yield emit("T5", "T5 · agent hypotheses", "the model proposes, the verifier decides, ambiguity is refused", mark);

  // ---- totals ---------------------------------------------------------------
  const settlementResults = [...state.results.values()];
  const totalRows = state.reconRows.length;
  const matchedRows = matchedRowCount(state);

  // Suspense: the value of everything genuinely unproven. Held settlements are
  // NOT in here — they park in 1215, which is a different and honest answer.
  const unprovenPaise = settlementResults
    .filter((r) => r.disposition === "UNPROVEN" || r.disposition === "OPEN")
    .reduce((a, r) => a + abs(r.amountPaise), 0n);
  const heldPaise = settlementResults
    .filter((r) => r.disposition === "HELD")
    .reduce((a, r) => a + abs(r.amountPaise), 0n);
  const absorbedPaise = settlementResults.reduce((a, r) => a + r.absorbedPaise, 0n);

  return {
    totalRows,
    matchedRows,
    unprovenPaise,
    heldPaise,
    absorbedPaise,
    autoMatchPct: totalRows === 0 ? 0 : (matchedRows / totalRows) * 100,
    stages,
    settlements: settlementResults,
    links: state.links,
    exceptions: classify(state, period),
    judged: state.judged,
  };
}

/**
 * Rows a person never has to look at.
 *
 * A held settlement counts: no bank credit is expected while the hold stands,
 * its money is accounted for at 1215, and nothing about it is unproven. An
 * open or unproven one does not, whatever its narration looked like.
 */
function matchedRowCount(state: State): number {
  let n = 0;
  for (const r of state.results.values()) {
    if (r.disposition === "PROVEN_BANK" || r.disposition === "HELD") n += r.matchedRows;
  }
  return n;
}

/** Drain the generator. For every caller that does not need per-tier progress. */
/**
 * Judge a single claim against a fresh run, and return what the verifier said.
 *
 * Used by the agent tool loop and by the exception resolver, so a person
 * clicking "these two go together" is held to exactly the same standard as a
 * model proposing it — same code, same rejection text. A second implementation
 * of "is this claim true" is a second answer waiting to disagree.
 */
export function verifyOne(input: ReconcileInput, p: Proposal): VerifierVerdict {
  const claim: Proposal = { ...p, source: "T5" };
  const r = reconcile({ ...input, proposals: [claim] });
  return (
    r.judged.filter((j) => j.proposal.source === "T5").at(-1)?.verdict ?? {
      verdict: "REJECT",
      reason: "the verifier never saw this claim",
      deltaPaise: 0n,
      proposerDeltaPaise: 0n,
    }
  );
}

export function reconcile(input: ReconcileInput): RunResult {
  const it = reconcileStaged(input);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}
