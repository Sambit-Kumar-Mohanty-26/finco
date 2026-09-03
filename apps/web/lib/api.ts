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
  stages: {
    tiers?: Tier[];
    autoMatchPct?: number;
    settlements?: SettlementResult[];
    agent?: AgentSummary;
    judged?: Judged[];
    heldPaise?: string;
    absorbedPaise?: string;
  } | null;
  links?: MatchLink[];
  events?: RunEvent[];
  exceptions?: { open: number; total: number };
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

// --- P3: runs are asynchronous now -------------------------------------------

export type RunEvent = { seq: number; type: string; payload: Record<string, unknown> };

/** One claim as the verifier judged it, kept beside the claim it judged. */
export type Judged = {
  bankRef: string;
  settlementRefs: string[];
  basis: string;
  source: string;
  claim: string | null;
  model: string | null;
  verdict: "ACCEPT" | "REJECT" | "ESCALATE";
  reason: string;
  proposerDeltaPaise: string;
};

export type AgentSummary = {
  notes: string[];
  usage: { rounds: number; inputTokens: number; outputTokens: number; costPaise: string; cached: boolean } | null;
};

// --- P4: exceptions and the ledger -------------------------------------------

export type ExceptionSpec = {
  code: string;
  label: string;
  owner: string;
  autoResolvable: boolean;
  parksTo: string;
  severity: "blocking" | "review" | "info";
  slaHours: number;
  playbook: string[];
};

export type Exception = {
  id: string;
  runId: string;
  datasetId: string;
  code: string;
  subjectType: string;
  subjectRef: string;
  amountPaise: string;
  parksTo: string;
  autoResolvable: boolean;
  reason: string;
  asOf: string | null;
  evidence: Record<string, unknown>;
  status: "OPEN" | "RESOLVED" | "WRITTEN_OFF";
  resolution: string | null;
  resolvedAt: string | null;
  spec: ExceptionSpec | null;
  related?: MatchLink[];
};

export type Facet = { code: string; n: number; valuePaise: string; label: string; owner: string };

export type ExceptionPage = {
  exceptions: Exception[];
  facets: Facet[];
  statuses: { status: string; n: number }[];
  nextCursor: string | null;
};

export type TrialAccount = {
  account: string;
  name: string;
  type: string;
  debitPaise: string;
  creditPaise: string;
  netPaise: string;
  lines: number;
};

export type TrialBalance = {
  accounts: TrialAccount[];
  totals: { debitPaise: string; creditPaise: string; deltaPaise: string };
  balanced: boolean;
  suspense: { account: string; netPaise: string; lines: number };
};

export type JournalEntry = {
  id: string;
  entryDate: string;
  period: string;
  memo: string;
  sourceType: string;
  sourceRef: string;
  reversalOf: string | null;
  lines: { account: string; debitPaise: string; creditPaise: string; memo: string }[];
};

export type Actor = { id: string; tenantId: string; email: string; name: string; role: string };

// --- P6: the scorecard --------------------------------------------------------

export type Scorecard = {
  runId: string;
  period: string;
  runHash: string;
  totalRows: number;
  matchedRows: number;
  autoMatchPct: number;
  precision: number | null;
  recall: number | null;
  falseMatches: { bankRef: string; settlementRefs: string[]; tier: string; reason: string }[];
  valueCoveragePct: number;
  unprovenPaise: string;
  exceptionF1: number | null;
  exceptionDetail: { code: string; tp: number; fp: number; fn: number; f1: number }[];
  identityClosurePct: number;
  measurable: boolean;
  note: string;
  thresholds: Record<string, number>;
  failures: { metric: string; got: number | null; want: number; note: string }[];
  replayMatchesRun: boolean;
};

export type ScalePoint = {
  rows: number;
  ms: number;
  autoMatchPct: number;
  precision: number | null;
  recall: number | null;
  exceptionF1: number | null;
  valueCoveragePct: number;
  passes: boolean;
};

/**
 * A mutation, from the browser.
 *
 * `credentials: "include"` is not optional: the session cookie is set by the
 * API on its own origin, so without it every posting route answers 401. The
 * error BODY is returned rather than thrown away, because the API's refusals
 * carry the reason a person needs to see — the verifier's arithmetic, or which
 * exception classes a bulk selection mixed.
 */
export async function apiSend<T>(
  path: string,
  body?: unknown,
  method: "POST" | "DELETE" = "POST",
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; detail: Record<string, unknown> }> {
  try {
    const r = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: String(parsed.error ?? `API responded ${r.status}`),
        detail: parsed,
      };
    }
    return { ok: true, data: parsed as T };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message, detail: {} };
  }
}

// --- P7: cash ------------------------------------------------------------------

/** Money is a decimal string on the wire; every *Paise field below is one. */
export type ForecastPoint = {
  date: string;
  grossPaise: string;
  p10Paise: string;
  p50Paise: string;
  p90Paise: string;
  cumP10Paise: string;
  cumP50Paise: string;
  cumP90Paise: string;
  bankingDay: boolean;
};

export type AgeingBucket = {
  key: string;
  label: string;
  fromDays: number;
  toDays: number | null;
  items: number;
  valuePaise: string;
  overdue: boolean;
};

export type FloorVerdict = {
  floorPaise: string;
  expectedPaise: string;
  breach: boolean;
  shortfallPaise: string;
  clearsOn: string | null;
};

export type Propensity = { rate: number; low: number; high: number; n: number };

export type CashForecast = {
  datasetId: string;
  datasetName: string;
  period: string;
  asOf: string;
  days: number;
  curve: ForecastPoint[];
  buckets: AgeingBucket[];
  floor: FloorVerdict;
  propensity: { domestic: Propensity; international: Propensity };
  unprovenPaise: string;
  cachedAgeMs: number;
  stale: boolean;
};

// --- P8: governance ------------------------------------------------------------

export type EffectivePolicy = {
  tenantId: string;
  autonomyCapPaise: string;
  materialityPaise: string;
  cashFloorPaise: string;
  suspenseCeilingPaise: string;
  autonomyMode: "observe" | "assist" | "auto";
  killSwitch: boolean;
  killReason: string;
  updatedAt: string | null;
  modes?: readonly string[];
};

export type Connection = {
  key: string;
  label: string;
  status: "OK" | "NO DATA" | "NOT CONFIGURED";
  rows: number;
  newest: string | null;
  signatureFailures?: number;
};

export type Connections = {
  sources: Connection[];
  orderReceiptCoverage: { pct: number | null; rowsWithReceipt: number; rowsTotal: number; fix: string };
};

export type AuditEntry = {
  seq: number;
  at: string;
  actorEmail: string;
  action: string;
  subjectType: string;
  subjectRef: string;
  detail: Record<string, unknown>;
  hash: string;
};

export type CheckItem = { key: string; label: string; why: string; pass: boolean; detail: string };

export type PeriodDetail = {
  period: string;
  state: "OPEN" | "LOCKED";
  lockedAt: string | null;
  lockedBy: string | null;
  items: CheckItem[];
  ready: boolean;
  runId: string | null;
};

export type Agreement = {
  runId: string;
  period: string;
  agreementPct: number | null;
  decided: number;
  open: number;
  agreedAuto: number;
  agreedEscalate: number;
  wrong: number;
  timid: number;
  valueWrongPaise: string;
  policy: { autonomyMode?: string; autonomyCapPaise?: string; killSwitch?: boolean; posted?: boolean } | null;
  note: string;
};
