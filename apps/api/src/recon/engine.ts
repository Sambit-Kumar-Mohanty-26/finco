import { bankingWindow } from "@finco/core";
import { parseNarration } from "./narration.ts";

/**
 * Deterministic reconciliation, T0 to T2.
 *
 * Pure functions over plain objects: no database, no clock, no IO. That is what
 * makes the golden test possible — the same dataset must always produce the
 * same match count, and a run whose result depends on when it ran is not a
 * control.
 *
 * The engine never "decides". Every link it emits carries an arithmetic
 * identity that closed to zero paise, or it is not emitted. Where the numbers
 * add up but not uniquely, the verdict is ESCALATED and nothing is posted —
 * adding up is not the same as being the only thing that adds up.
 */

export type Verdict = "PROVEN" | "ESCALATED" | "REFUSED";
export type Tier = "T0" | "T1" | "T2";

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

export type SettlementResult = {
  ref: string;
  amountPaise: bigint;
  /** I1: settlement amount minus (credits - debits). Zero means it closes. */
  deltaPaise: bigint;
  closes: boolean;
  /** Set once a bank credit is proven against it. */
  bankProvenBy: Tier | null;
  rows: number;
  matchedRows: number;
  note: string;
};

export type Stage = {
  key: string;
  tier: Tier | "GATE";
  label: string;
  detail: string;
  matchedRows: number;
  links: number;
  escalated: number;
};

export type RunResult = {
  totalRows: number;
  matchedRows: number;
  unprovenPaise: bigint;
  autoMatchPct: number;
  stages: Stage[];
  settlements: SettlementResult[];
  links: Link[];
};

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

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

export function reconcile(input: {
  settlements: SettlementIn[];
  reconRows: ReconRowIn[];
  bankLines: BankLineIn[];
  erpInvoices: ErpInvoiceIn[];
}): RunResult {
  const { settlements, reconRows, bankLines, erpInvoices } = input;

  const rowsBySettlement = new Map<string, ReconRowIn[]>();
  for (const r of reconRows) {
    const k = r.settlementRef ?? "";
    const list = rowsBySettlement.get(k);
    if (list) list.push(r);
    else rowsBySettlement.set(k, [r]);
  }
  const invoiceByReceipt = new Map(erpInvoices.map((i) => [i.orderReceipt, i]));

  const results = new Map<string, SettlementResult>();
  /** Every settlement gets an entry below, so a miss here is a programming error. */
  const resultFor = (ref: string): SettlementResult => {
    const r = results.get(ref);
    if (!r) throw new Error(`no settlement result for ${ref}`);
    return r;
  };
  const links: Link[] = [];

  // ---- T1a: prove each settlement against its own rows (I1) -----------------
  // Runs first because both T0 and T2 refuse to consume a settlement that does
  // not close internally: matching a bank credit to a settlement whose own rows
  // disagree would produce a "match" that proves nothing.
  for (const s of settlements) {
    const rows = rowsBySettlement.get(s.ref) ?? [];
    const delta = identityDelta(s.amountPaise, rows);
    // A row is matched only if its order also exists in the ERP register —
    // otherwise revenue would be recognised from the payment, not the invoice.
    const matchedRows = rows.filter(
      (r) => r.type !== "payment" || (r.orderId != null && invoiceByReceipt.has(r.orderId)),
    ).length;
    results.set(s.ref, {
      ref: s.ref,
      amountPaise: s.amountPaise,
      deltaPaise: delta,
      closes: delta === 0n,
      bankProvenBy: null,
      rows: rows.length,
      matchedRows,
      note: delta === 0n ? "" : `open by ${delta} paise`,
    });
  }

  const consumedSettlements = new Set<string>();
  const consumedBankLines = new Set<string>();

  // ---- T0: exact key join on UTR -------------------------------------------
  for (const b of bankLines) {
    const { utr, format } = parseNarration(b.narration);
    if (!utr) continue;
    const group = settlements.filter((s) => s.utr === utr && !consumedSettlements.has(s.ref));
    if (group.length === 0) continue;

    const open = group.filter((s) => !resultFor(s.ref).closes);
    const firstOpen = open[0];
    if (firstOpen) {
      links.push({
        tier: "T0",
        verdict: "REFUSED",
        leftType: "bank_line",
        leftRef: b.ref,
        rightType: "settlement",
        rightRef: firstOpen.ref,
        amountPaise: b.creditPaise,
        deltaPaise: resultFor(firstOpen.ref).deltaPaise,
        reason: `settlement ${firstOpen.ref} does not close against its own rows`,
      });
      continue;
    }

    const delta = bankDelta(
      b.creditPaise,
      b.chargesPaise,
      group.map((s) => s.amountPaise),
    );
    const verdict: Verdict = delta === 0n ? "PROVEN" : "REFUSED";
    for (const s of group) {
      links.push({
        tier: "T0",
        verdict,
        leftType: "bank_line",
        leftRef: b.ref,
        rightType: "settlement",
        rightRef: s.ref,
        amountPaise: s.amountPaise,
        deltaPaise: delta,
        reason: verdict === "PROVEN" ? `exact UTR (${format})` : `I2 open by ${delta} paise`,
      });
      if (verdict === "PROVEN") {
        consumedSettlements.add(s.ref);
        resultFor(s.ref).bankProvenBy = "T0";
      }
    }
    if (verdict === "PROVEN") consumedBankLines.add(b.ref);
  }

  // ---- T1b: settlement UTR present on the line but not parseable ------------
  // The narration failed the parser, but the settlement's own UTR still appears
  // verbatim inside it. Cheap, exact, and it recovers the truncation cases.
  for (const b of bankLines) {
    if (consumedBankLines.has(b.ref)) continue;
    const hay = b.narration.toUpperCase();
    const group = settlements.filter(
      (s) => s.utr && hay.includes(s.utr.toUpperCase()) && !consumedSettlements.has(s.ref),
    );
    if (group.length === 0) continue;
    if (group.some((s) => !resultFor(s.ref).closes)) continue;

    const delta = bankDelta(
      b.creditPaise,
      b.chargesPaise,
      group.map((s) => s.amountPaise),
    );
    if (delta !== 0n) continue;
    for (const s of group) {
      links.push({
        tier: "T1",
        verdict: "PROVEN",
        leftType: "bank_line",
        leftRef: b.ref,
        rightType: "settlement",
        rightRef: s.ref,
        amountPaise: s.amountPaise,
        deltaPaise: 0n,
        reason: "UTR found in narration, I2 closes",
      });
      consumedSettlements.add(s.ref);
      resultFor(s.ref).bankProvenBy = "T1";
    }
    consumedBankLines.add(b.ref);
  }

  // ---- T2: exact amount inside the T to T+2 banking window ------------------
  for (const b of bankLines) {
    if (consumedBankLines.has(b.ref)) continue;
    const target = b.creditPaise + b.chargesPaise;
    const candidates = settlements.filter((s) => {
      if (consumedSettlements.has(s.ref) || s.onHold) return false;
      if (!resultFor(s.ref).closes) return false;
      if (s.amountPaise !== target) return false;
      // The credit must land on or within two banking days of the settlement.
      return bankingWindow(s.settledOn, 2).includes(b.valueDate);
    });

    if (candidates.length === 0) continue;

    // Adding up is not the same as being the only thing that adds up.
    if (candidates.length > 1) {
      links.push({
        tier: "T2",
        verdict: "ESCALATED",
        leftType: "bank_line",
        leftRef: b.ref,
        rightType: "settlement",
        rightRef: candidates.map((c) => c.ref).join(","),
        amountPaise: b.creditPaise,
        deltaPaise: 0n,
        reason: `ambiguous: ${candidates.length} settlements match this amount and window`,
      });
      continue;
    }

    const s = candidates[0]!; // length === 1, guarded above
    links.push({
      tier: "T2",
      verdict: "PROVEN",
      leftType: "bank_line",
      leftRef: b.ref,
      rightType: "settlement",
      rightRef: s.ref,
      amountPaise: s.amountPaise,
      deltaPaise: 0n,
      reason: `exact amount within T+2 of ${s.settledOn}`,
    });
    consumedSettlements.add(s.ref);
    consumedBankLines.add(b.ref);
    resultFor(s.ref).bankProvenBy = "T2";
  }

  // ---- totals ---------------------------------------------------------------
  const settlementResults = [...results.values()];
  const provenRows = (tier: Tier | null) =>
    settlementResults
      .filter((r) => r.closes && (tier === null ? r.bankProvenBy !== null : r.bankProvenBy === tier))
      .reduce((a, r) => a + r.matchedRows, 0);

  const totalRows = reconRows.length;
  const matchedRows = provenRows(null);

  // Suspense: the value of everything not proven. A percentage is a statistic;
  // this is a number in rupees a controller already knows how to read.
  const unprovenPaise = settlementResults
    .filter((r) => r.bankProvenBy === null)
    .reduce((a, r) => a + (r.amountPaise < 0n ? -r.amountPaise : r.amountPaise), 0n);

  const at = (t: Tier) => links.filter((l) => l.tier === t);
  const cum = (t: Tier): number =>
    t === "T0"
      ? provenRows("T0")
      : t === "T1"
        ? provenRows("T0") + provenRows("T1")
        : matchedRows;

  const stages: Stage[] = [
    {
      key: "T0",
      tier: "T0",
      label: "T0 · exact key join",
      detail: "UTR, settlement id, order id",
      matchedRows: cum("T0"),
      links: at("T0").filter((l) => l.verdict === "PROVEN").length,
      escalated: at("T0").filter((l) => l.verdict !== "PROVEN").length,
    },
    {
      key: "T1",
      tier: "T1",
      label: "T1 · identity close",
      detail: "I1 per settlement, then I2 on the bank credit",
      matchedRows: cum("T1"),
      links: at("T1").filter((l) => l.verdict === "PROVEN").length,
      escalated: at("T1").filter((l) => l.verdict !== "PROVEN").length,
    },
    {
      key: "T2",
      tier: "T2",
      label: "T2 · amount and banking window",
      detail: "exact amount within T to T+2, unique solution required",
      matchedRows: cum("T2"),
      links: at("T2").filter((l) => l.verdict === "PROVEN").length,
      escalated: at("T2").filter((l) => l.verdict !== "PROVEN").length,
    },
  ];

  return {
    totalRows,
    matchedRows,
    unprovenPaise,
    autoMatchPct: totalRows === 0 ? 0 : (matchedRows / totalRows) * 100,
    stages,
    settlements: settlementResults,
    links,
  };
}
