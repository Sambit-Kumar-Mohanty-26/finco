import { paise, type Paise } from "@finco/core";

/**
 * A close run, stage by stage.
 *
 * The numbers are internally consistent and someone will check them:
 *   - deterministic tiers T0..T3 reach 4,200 of 5,000 = 84.0%, the P1 gate
 *   - the agent stage posts nothing, so its cumulative count does not move
 *   - the verifier accepts 197 of 214 proposed links, which resolve 505 rows
 *   - final 4,705 of 5,000 = 94.1% auto-match, 295 rows unproven
 *
 * A proposal is a link, not a row: one merged-credit link can resolve hundreds
 * of payments, which is why 197 accepted links move the count by 505.
 */
export type Stage = {
  key: string;
  label: string;
  detail: string;
  /** cumulative rows matched once this stage completes */
  matched: number;
  /** what to show on the right; omit to show the cumulative count */
  rightLabel?: string;
  kind: "deterministic" | "agent" | "gate";
};

export const TOTAL_ROWS = 5000;

export const STAGES: Stage[] = [
  { key: "ingest", label: "Ingest", detail: "3 sources, canonicalised to paise", matched: 0, rightLabel: "5,000 rows", kind: "deterministic" },
  { key: "t0", label: "T0 · exact key", detail: "utr, settlement_id, order_id", matched: 3900, kind: "deterministic" },
  { key: "t1", label: "T1 · identity", detail: "per-settlement close, delta 0", matched: 4060, kind: "deterministic" },
  { key: "t2", label: "T2 · window", detail: "amount + T to T+2 banking days", matched: 4160, kind: "deterministic" },
  { key: "t3", label: "T3 · subset-sum", detail: "bounded, unique solutions only", matched: 4200, kind: "deterministic" },
  { key: "agent", label: "Agent", detail: "214 proposals on 800 residual rows", matched: 4200, rightLabel: "proposes only", kind: "agent" },
  { key: "verify", label: "Verifier", detail: "197 accepted · 17 rejected", matched: 4705, kind: "gate" },
];

export const RUN = {
  id: "run_2026_06_11_a3f9c1",
  period: "11 Jun 2026",
  autoMatch: "94.1%",
  precision: "1.000",
  falseMatches: 0,
  exceptions: 24,
  unproven: paise(24188000n) as Paise,
  proposalsMade: 214,
  proposalsAccepted: 197,
  proposalsRejected: 17,
};

/** The exception that surfaces when the run finishes. */
export const SURFACED = {
  code: "E08",
  name: "MERGED CREDIT",
  amount: paise(49344665n) as Paise,
  reason: "two distinct subsets hit the target; uniqueness failed",
};
