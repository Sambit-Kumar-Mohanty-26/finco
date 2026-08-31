/**
 * The chart of accounts, and the one rule a journal has to obey.
 *
 * Output is a balanced journal, not a match CSV. A CSV of matches cannot fail;
 * a ledger can, loudly, and that is the point. 9999 is the honest exception
 * list expressed in rupees rather than as a percentage of rows: a match rate is
 * a statistic, "2,41,880 unproven, oldest item 6 days" is a control a
 * controller already knows how to read.
 */

export type AccountType = "asset" | "liability" | "income" | "expense" | "contra_income";

export type Account = {
  code: string;
  name: string;
  type: AccountType;
  /** Debits increase an asset or expense; credits increase everything else. */
  normal: "debit" | "credit";
};

export const ACCOUNTS: readonly Account[] = [
  { code: "1010", name: "Bank — current account", type: "asset", normal: "debit" },
  { code: "1210", name: "Razorpay receivable", type: "asset", normal: "debit" },
  { code: "1215", name: "Razorpay on hold", type: "asset", normal: "debit" },
  { code: "1410", name: "GST input credit", type: "asset", normal: "debit" },
  { code: "2110", name: "Route payable", type: "liability", normal: "credit" },
  { code: "4010", name: "Revenue", type: "income", normal: "credit" },
  { code: "4090", name: "Refunds and reversals", type: "contra_income", normal: "debit" },
  { code: "5210", name: "Gateway fees", type: "expense", normal: "debit" },
  { code: "5290", name: "Chargeback losses", type: "expense", normal: "debit" },
  { code: "9999", name: "Suspense — unreconciled", type: "asset", normal: "debit" },
] as const;

export const SUSPENSE = "9999";

const BY_CODE = new Map(ACCOUNTS.map((a) => [a.code, a]));
export const accountName = (code: string) => BY_CODE.get(code)?.name ?? code;
export const isAccount = (code: string) => BY_CODE.has(code);

/** One side of one posting. Debit and credit are separate columns, never one signed one. */
export type JournalLine = {
  account: string;
  debitPaise: bigint;
  creditPaise: bigint;
  memo: string;
  /** What this line was derived from, so any rupee can be walked back to a row. */
  sourceType?: string;
  sourceRef?: string;
};

export type BalanceError = { ok: false; reason: string; deltaPaise: bigint };
export type BalanceOk = { ok: true; totalPaise: bigint };

/**
 * The gate every journal passes before it is allowed near the database.
 *
 * Checked in code rather than by a constraint because "debits equal credits"
 * is a property of a SET of rows, and a Postgres CHECK constraint only ever
 * sees one row. The caller writes the entry and its lines in a single
 * transaction, so an unbalanced journal cannot exist even for an instant.
 *
 * ponytail: a deferred constraint trigger would move this into the database.
 * Worth doing the day something other than this service writes journal lines.
 */
export function checkBalanced(lines: readonly JournalLine[]): BalanceOk | BalanceError {
  if (lines.length === 0) return { ok: false, reason: "journal has no lines", deltaPaise: 0n };
  let dr = 0n;
  let cr = 0n;
  for (const l of lines) {
    if (l.debitPaise < 0n || l.creditPaise < 0n) {
      return { ok: false, reason: `negative amount on ${l.account}`, deltaPaise: 0n };
    }
    if (l.debitPaise > 0n && l.creditPaise > 0n) {
      return { ok: false, reason: `${l.account} is both debited and credited`, deltaPaise: 0n };
    }
    if (!isAccount(l.account)) {
      return { ok: false, reason: `${l.account} is not in the chart of accounts`, deltaPaise: 0n };
    }
    dr += l.debitPaise;
    cr += l.creditPaise;
  }
  if (dr !== cr) return { ok: false, reason: "debits do not equal credits", deltaPaise: dr - cr };
  if (dr === 0n) return { ok: false, reason: "journal is entirely zero", deltaPaise: 0n };
  return { ok: true, totalPaise: dr };
}

/** Drop lines that would post nothing. A zero line is noise in an audit trail. */
export const nonZero = (lines: readonly JournalLine[]): JournalLine[] =>
  lines.filter((l) => l.debitPaise !== 0n || l.creditPaise !== 0n);
