import type { Exception, RunEvent } from "./api";

/**
 * The pure decisions the review surfaces make.
 *
 * These three live here rather than inside their components for one reason:
 * each of them is wrong in a way nobody would notice by looking. A progress
 * list that quietly drops a tier still renders. A bulk bar whose rules have
 * drifted from the API's still looks enabled. A narration highlighter that eats
 * a character still shows a plausible-looking narration. So they are separated
 * from their JSX and asserted in review.check.mts.
 */

// --- the run timeline ---------------------------------------------------------

export type Stage = {
  key: string;
  label: string;
  detail: string;
  matchedRows: number;
  links: number;
  escalated: number;
  committed: number;
};

export type Folded = {
  stages: Map<string, Stage>;
  finished: Record<string, unknown> | null;
  failure: string | null;
  /** The highest seq folded in; what a reconnect asks to resume after. */
  seq: number;
};

/**
 * Fold a stream of run events into what the timeline draws.
 *
 * Events at or below a seq already folded are DROPPED. That is not paranoia:
 * EventSource replays from Last-Event-ID on every reconnect, so duplicates are
 * the normal case, and a fold that counted them would show eleven tiers.
 *
 * Because the fold is over the whole event list and is order-insensitive above
 * the seq guard, a run replayed from the database after it finished produces
 * exactly the same result as one watched live, tier by tier. That equality is
 * the property the timeline is built on, and it is what the check asserts.
 */
export function foldEvents(events: readonly RunEvent[], from = 0): Folded {
  const out: Folded = { stages: new Map(), finished: null, failure: null, seq: from };
  for (const e of events) {
    if (!Number.isFinite(e.seq) || e.seq <= out.seq) continue;
    out.seq = e.seq;
    if (e.type === "stage") out.stages.set(String(e.payload.key), e.payload as unknown as Stage);
    else if (e.type === "finished") out.finished = e.payload;
    else if (e.type === "failed") out.failure = String(e.payload.error ?? "the run failed");
  }
  return out;
}

// --- the bulk bar -------------------------------------------------------------

/**
 * Why the bulk approve button cannot act, in the specific.
 *
 * These are the same three rules POST /v1/exceptions/bulk-approve enforces, and
 * this function is a PREVIEW of its answer, never a substitute for asking it —
 * the API is still the authority and still refuses on its own. What this buys
 * is that the bar can say "the selection mixes E02 and E03" before the click
 * rather than greying itself out and leaving somebody to guess.
 */
export function bulkBlockReason(chosen: readonly Exception[]): string | null {
  if (chosen.length === 0) return "Select rows with x.";
  const codes = [...new Set(chosen.map((r) => r.code))];
  if (codes.length > 1) {
    return `The selection mixes ${codes.join(" and ")} — approve one class at a time.`;
  }
  if (chosen.some((r) => r.status !== "OPEN")) {
    return "Some of the selection is already resolved.";
  }
  if (chosen.some((r) => !r.autoResolvable)) {
    return `${codes[0]} needs a decision per item; open the resolver with e.`;
  }
  return null;
}

// --- the narration ------------------------------------------------------------

/** UTRs are 12–22 alphanumerics; long digit runs are amounts or account numbers. */
const TOKEN = /([A-Z]{2,6}[A-Z0-9]{8,20}|\d{6,})/g;

/**
 * Split a bank narration into alternating plain and token pieces.
 *
 * Odd indices are the tokens, which is how String.split with one capture group
 * behaves. The invariant that matters, and the one the check pins: joining the
 * pieces back together returns the input EXACTLY. A narration is the only free
 * text a reviewer has to read character by character — "is that UTR truncated,
 * or is it a different UTR" cannot be answered from a string that lost a digit
 * to a highlighter.
 */
export function splitNarration(text: string): string[] {
  return text.split(TOKEN);
}
