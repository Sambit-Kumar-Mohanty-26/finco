import { paise, type Paise } from "@finco/core";

/**
 * Trial balance and exception register.
 *
 * These tie, deliberately and checkably:
 *   - debits equal credits exactly (see ledger.check.mts)
 *   - the 9999 suspense balance equals the sum of the open exceptions
 *   - that same figure is RUN.unproven in run.ts
 *
 * Debits and credits are separate columns, never one signed column.
 */
export type TrialRow = {
  account: string;
  debit: Paise;
  credit: Paise;
  flag?: boolean;
};

const z = paise(0n);

export const TRIAL_BALANCE: TrialRow[] = [
  { account: "1010 Bank — current", debit: paise(381442100n), credit: z },
  { account: "1210 Razorpay receivable", debit: paise(184211000n), credit: z },
  { account: "1215 Razorpay on hold", debit: paise(20450000n), credit: z },
  { account: "1410 GST input credit", debit: paise(13014700n), credit: z },
  { account: "5210 Gateway fees", debit: paise(72304000n), credit: z },
  { account: "9999 Suspense — unreconciled", debit: paise(24188000n), credit: z, flag: true },
  { account: "4010 Revenue", debit: z, credit: paise(685580200n) },
  { account: "2110 Route payable", debit: z, credit: paise(10029600n) },
];

export const TRIAL_TOTAL = {
  debit: paise(695609800n),
  credit: paise(695609800n),
};

export type ExceptionRow = {
  code: string;
  name: string;
  items: number;
  value: Paise;
  owner: string;
  verdict: "escalate" | "proven" | "blocked";
};

export const EXCEPTIONS: ExceptionRow[] = [
  { code: "E12", name: "Route transfer netting", items: 14, value: paise(10029600n), owner: "System", verdict: "proven" },
  { code: "E08", name: "Merged bank credit", items: 3, value: paise(6816200n), owner: "System", verdict: "escalate" },
  { code: "E13", name: "Period cutoff timing", items: 4, value: paise(6241000n), owner: "System", verdict: "proven" },
  { code: "E09", name: "Orphan payment", items: 2, value: paise(601100n), owner: "Sales ops", verdict: "blocked" },
  { code: "E14", name: "Unexplained adjustment", items: 1, value: paise(500100n), owner: "Finance", verdict: "blocked" },
];

/** 24 items, 2,41,880.00 — the same figure the suspense account carries. */
export const EXCEPTIONS_TOTAL = {
  items: 24,
  value: paise(24188000n),
};
