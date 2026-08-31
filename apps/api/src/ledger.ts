import { checkBalanced, nonZero, SUSPENSE, type JournalLine } from "@finco/core";
import type { ReconRowIn, RunResult, SettlementResult } from "./recon/engine.ts";

/**
 * The ledger derivation. Pure: rows and a run result in, balanced entries out.
 *
 * The output of a close is a balanced journal, not a match CSV. A CSV cannot
 * fail; a ledger can, loudly, and every entry below is constructed so that its
 * residual — the part nobody could explain — lands in 9999 rather than being
 * dropped. That residual is the honest exception list, priced in rupees.
 *
 * The invariant worth remembering: after a full close, 1210 Razorpay receivable
 * nets to exactly zero. Every settlement either arrived in the bank (1010),
 * is on hold (1215), or is unproven (9999). There is no fourth answer.
 */

export type Posting = {
  sourceType: "settlement_activity" | "bank_credit" | "settlement_hold" | "settlement_suspense" | "fee_absorption";
  sourceRef: string;
  entryDate: string;
  memo: string;
  lines: JournalLine[];
};

const line = (
  account: string,
  debitPaise: bigint,
  creditPaise: bigint,
  memo: string,
  sourceType?: string,
  sourceRef?: string,
): JournalLine => ({ account, debitPaise, creditPaise, memo, sourceType, sourceRef });

/** Put a signed amount on whichever side keeps it positive. */
const signed = (account: string, amount: bigint, memo: string): JournalLine =>
  amount >= 0n ? line(account, amount, 0n, memo) : line(account, 0n, -amount, memo);

/**
 * Entry 1 — what the settlement's own rows say happened.
 *
 * Revenue is recognised at gross and the fee is an expense, because a merchant
 * who books revenue net of MDR understates both revenue and cost and cannot
 * reclaim the GST on the fee. The residual to 9999 is deliberate: anything this
 * function cannot name is visible rather than absorbed.
 */
export function activityEntry(
  ref: string,
  entryDate: string,
  rows: readonly ReconRowIn[],
): Posting | null {
  let net = 0n;
  let gross = 0n;
  let feeBase = 0n;
  let tax = 0n;
  let refunds = 0n;
  let transfers = 0n;
  let disputes = 0n; // debits positive, reversals negative
  let named = 0n; // the part of net the lines below account for

  for (const r of rows) {
    net += r.creditPaise - r.debitPaise;
    if (r.type === "payment") {
      const fee = r.feePaise ?? 0n;
      const t = r.taxPaise ?? 0n;
      gross += r.creditPaise + fee;
      feeBase += fee - t;
      tax += t;
      named += r.creditPaise;
      continue;
    }
    if (r.type === "refund") {
      refunds += r.debitPaise;
      named -= r.debitPaise;
      continue;
    }
    if (r.type === "transfer") {
      transfers += r.debitPaise;
      named -= r.debitPaise;
      continue;
    }
    if (r.disputeId) {
      disputes += r.debitPaise - r.creditPaise;
      named += r.creditPaise - r.debitPaise;
      continue;
    }
    if (r.entityId.startsWith("setlod_")) {
      feeBase += r.debitPaise;
      named -= r.debitPaise;
      continue;
    }
    // Anything left is unexplained. It is NOT dropped and NOT absorbed.
  }

  const residual = net - named; // unexplained adjustments, either direction
  const lines = nonZero([
    signed("1210", net, `${ref} net movement`),
    line("4010", 0n, gross, `${ref} revenue at gross`),
    signed("5210", feeBase, `${ref} gateway fee`),
    signed("1410", tax, `${ref} GST input credit on fee`),
    signed("4090", refunds, `${ref} refunds`),
    signed("2110", transfers, `${ref} route transfers`),
    signed("5290", disputes, `${ref} disputes`),
    signed(SUSPENSE, -residual, `${ref} unexplained adjustment`),
  ]);
  if (lines.length === 0) return null;
  return {
    sourceType: "settlement_activity",
    sourceRef: ref,
    entryDate,
    memo: `Settlement ${ref} — activity from the recon report`,
    lines,
  };
}

/** Entry 2 — cash arrived. This is I2 expressed as a posting. */
export function bankEntry(
  bankRef: string,
  entryDate: string,
  creditPaise: bigint,
  chargesPaise: bigint,
  settlements: readonly { ref: string; amountPaise: bigint }[],
): Posting {
  return {
    sourceType: "bank_credit",
    sourceRef: bankRef,
    entryDate,
    memo: `Bank credit ${bankRef} against ${settlements.map((s) => s.ref).join(", ")}`,
    lines: nonZero([
      line("1010", creditPaise, 0n, `${bankRef} credited`),
      line("5210", chargesPaise, 0n, `${bankRef} bank charges`),
      ...settlements.map((s) => line("1210", 0n, s.amountPaise, `${s.ref} settled`)),
    ]),
  };
}

/**
 * Entries 3 and 4 — where a settlement sits when no cash arrived.
 *
 * A hold is not an exception: no credit is due while it stands, and parking it
 * in 1215 says so. Everything else unproven goes to 9999 at full value, which
 * is the number a controller should be angry about if it is large.
 */
export function dispositionEntry(s: SettlementResult, entryDate: string): Posting | null {
  // What the activity and absorption entries left sitting in 1210. For a
  // settlement that closes this equals its amount; for one that does not, it is
  // the amount PLUS the unexplained part, because the receivable the recon
  // report created is just as unproven as the settlement itself.
  const clear = s.amountPaise - s.deltaPaise + s.absorbedPaise;
  if (s.disposition === "PROVEN_BANK" || clear === 0n) return null;
  const account = s.disposition === "HELD" ? "1215" : SUSPENSE;
  const sourceType = s.disposition === "HELD" ? "settlement_hold" : "settlement_suspense";
  return {
    sourceType,
    sourceRef: s.ref,
    entryDate,
    memo:
      s.disposition === "HELD"
        ? `${s.ref} on hold — no bank credit expected`
        : `${s.ref} unproven — ${s.note || "no bank credit could be proved"}`,
    lines: nonZero([
      signed(account, clear, `${s.ref} ${s.disposition.toLowerCase()}`),
      signed("1210", -clear, `${s.ref} cleared from receivable`),
    ]),
  };
}

/**
 * Entry 5 — the fee-rounding drift, posted rather than ignored.
 *
 * The settlement pays a few paise more or less than its rows imply. Below
 * materiality the engine absorbs it, and absorbing has to mean POSTING it to
 * 5210: an absorbed amount that is never written down is a rounding error that
 * grows every month and nobody can find.
 */
export function absorptionEntry(s: SettlementResult, entryDate: string): Posting | null {
  if (s.absorbedPaise === 0n) return null;
  return {
    sourceType: "fee_absorption",
    sourceRef: s.ref,
    entryDate,
    memo: `${s.ref} fee rounding of ${s.absorbedPaise} paise absorbed to 5210`,
    lines: nonZero([
      signed("1210", s.absorbedPaise, `${s.ref} rounding`),
      signed("5210", -s.absorbedPaise, `${s.ref} rounding`),
    ]),
  };
}

export type LedgerInput = {
  result: RunResult;
  rowsBySettlement: Map<string, ReconRowIn[]>;
  bankLines: Map<string, { valueDate: string; creditPaise: bigint; chargesPaise: bigint }>;
  entryDate: string;
};

/** Every posting a finished run implies, in a deterministic order. */
export function postingsFor(input: LedgerInput): Posting[] {
  const { result, rowsBySettlement, bankLines, entryDate } = input;
  const out: Posting[] = [];
  const byRef = new Map(result.settlements.map((s) => [s.ref, s]));

  for (const s of [...result.settlements].sort((a, b) => a.ref.localeCompare(b.ref))) {
    const activity = activityEntry(s.ref, entryDate, rowsBySettlement.get(s.ref) ?? []);
    if (activity) out.push(activity);
    const absorb = absorptionEntry(s, entryDate);
    if (absorb) out.push(absorb);
    const disp = dispositionEntry(s, entryDate);
    if (disp) out.push(disp);
  }

  // One cash entry per bank credit, however many settlements it covers.
  const proven = new Map<string, SettlementResult[]>();
  for (const l of result.links) {
    if (l.verdict !== "PROVEN") continue;
    const s = byRef.get(l.rightRef);
    if (!s) continue;
    const list = proven.get(l.leftRef);
    if (list) list.push(s);
    else proven.set(l.leftRef, [s]);
  }
  for (const bankRef of [...proven.keys()].sort()) {
    const b = bankLines.get(bankRef);
    if (!b) continue;
    out.push(bankEntry(bankRef, b.valueDate, b.creditPaise, b.chargesPaise, proven.get(bankRef)!));
  }

  return out;
}

/** Reject the whole batch if any entry does not balance. Nothing partial posts. */
export function assertBalanced(postings: readonly Posting[]): void {
  for (const p of postings) {
    const check = checkBalanced(p.lines);
    if (!check.ok) {
      throw new Error(
        `refusing to post ${p.sourceType}/${p.sourceRef}: ${check.reason} (off by ${check.deltaPaise} paise)`,
      );
    }
  }
}

/** Account code to net debit balance. Credits are negative. */
export function trialBalance(postings: readonly Posting[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const p of postings) {
    for (const l of p.lines) {
      out.set(l.account, (out.get(l.account) ?? 0n) + l.debitPaise - l.creditPaise);
    }
  }
  return out;
}
