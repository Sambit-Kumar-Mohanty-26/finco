import { paise } from "@finco/core";

/**
 * The single place the API base URL is decided.
 *
 * NEXT_PUBLIC_* is inlined at build time, so changing it on Vercel does nothing
 * until the next deploy — that surprise is worth knowing about once rather than
 * debugging twice.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Dataset = {
  id: string;
  name: string;
  period: string;
  source: string;
  counts: { settlements?: number; reconRows?: number; bankLines?: number; erpInvoices?: number };
  createdAt: string;
};

export type Tier = { key: string; label: string; detail: string; matchedRows: number; links: number; escalated: number };

export type SettlementResult = {
  ref: string;
  amountPaise: string;
  deltaPaise: string;
  closes: boolean;
  bankProvenBy: string | null;
  rows: number;
  matchedRows: number;
  note: string;
};

export type Run = {
  id: string;
  datasetId: string | null;
  period: string;
  state: string;
  totalRows: string;
  matchedRows: string;
  unprovenPaise: string;
  createdAt: string;
  finishedAt: string | null;
  stages: { tiers?: Tier[]; autoMatchPct?: number; settlements?: SettlementResult[] } | null;
  links?: MatchLink[];
};

export type MatchLink = {
  id: string;
  tier: string;
  verdict: string;
  leftRef: string;
  rightRef: string;
  amountPaise: string;
  deltaPaise: string;
  reason: string;
};

/** Server-side reads. `no-store` because a cached ledger is a wrong ledger. */
export async function apiGet<T>(path: string): Promise<T | { error: string }> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!r.ok) return { error: `API responded ${r.status}` };
    return (await r.json()) as T;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Wire format for money is a decimal string; convert once, at the boundary. */
export const paiseOf = (v: string | null | undefined) => paise(v ?? "0");

export const isErr = <T,>(v: T | { error: string }): v is { error: string } =>
  typeof v === "object" && v !== null && "error" in v;
