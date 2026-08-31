"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, apiSend, type Run, type RunEvent } from "@/lib/api";
import { TierBadge } from "@/components/app/Badges";
import { foldEvents } from "@/lib/review";

/**
 * Live progress for a close run.
 *
 * The property worth naming, because it is what the phase plan asks for and
 * what most progress UI gets wrong: a FINISHED run renders through exactly this
 * component and exactly this code path. There is no "live view" and separate
 * "results view" to drift apart. The server hands over whatever events already
 * exist, and if the run is still going a stream appends more. Opening a run
 * from three weeks ago shows the same six rows in the same order.
 *
 * Three failure modes are handled explicitly rather than hoped away:
 *
 *  - Out of order. Events are keyed by a monotonic seq and anything at or below
 *    the highest seq already rendered is DROPPED. A reconnect that replays is
 *    normal, not exceptional — EventSource does it on every network blip.
 *  - The stream ending early. A proxy can cut an idle connection, and the
 *    browser reconnects, but the run may also have finished in the gap. So the
 *    close handler always reconciles against GET /v1/runs/:id, which is the
 *    authority; the stream is only an accelerator.
 *  - The worker dying. A FAILED run gets a Resume button rather than a dead
 *    page, because the job resumes from its last committed stage and re-running
 *    is safe: every write is idempotent.
 */

const TIER_KEYS = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
const TERMINAL = (state: string) => state === "SCORED" || state === "FAILED";

export function RunTimeline({ run }: { run: Run }) {
  const router = useRouter();
  const [events, setEvents] = useState<RunEvent[]>(run.events ?? []);
  const [state, setState] = useState(run.state);
  const [live, setLive] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The highest seq rendered. A ref, not state: the SSE handler needs the
  // current value on every message, and a stale closure over state would let a
  // replayed event through.
  const seqRef = useRef(Math.max(0, ...(run.events ?? []).map((e) => e.seq)));

  useEffect(() => {
    if (TERMINAL(state)) return;

    let cancelled = false;
    const src = new EventSource(`${API_BASE}/v1/runs/${run.id}/stream?lastEventId=${seqRef.current}`);

    const onEvent = (e: MessageEvent) => {
      const seq = Number(e.lastEventId);
      if (!Number.isFinite(seq) || seq <= seqRef.current) return; // replay, or out of order
      seqRef.current = seq;
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        return; // a truncated frame is not worth a crash
      }
      setEvents((prev) => [...prev, { seq, type: e.type, payload }]);
    };

    src.addEventListener("open", () => setLive(true));
    src.addEventListener("stage", onEvent);
    src.addEventListener("finished", onEvent);
    src.addEventListener("failed", onEvent);

    /**
     * Reconcile, always. The stream is an accelerator over run_events, never
     * the record — so whatever it did or did not deliver, the row in the
     * database is what gets rendered once it stops.
     */
    const reconcile = async () => {
      if (cancelled) return;
      setLive(false);
      const r = await fetch(`${API_BASE}/v1/runs/${run.id}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok || cancelled) return;
      const fresh = (await r.json()) as Run;
      seqRef.current = Math.max(0, ...(fresh.events ?? []).map((e) => e.seq));
      setEvents(fresh.events ?? []);
      setState(fresh.state);
      // The page around this component is a server render of the same run, so
      // once it is finished the whole page is refetched rather than leaving the
      // tier list ahead of the tables under it.
      if (TERMINAL(fresh.state)) router.refresh();
    };

    src.addEventListener("error", () => {
      // EventSource retries on its own; only a closed source is final.
      if (src.readyState === EventSource.CLOSED) void reconcile();
      else setLive(false);
    });
    src.addEventListener("finished", () => {
      src.close();
      void reconcile();
    });
    src.addEventListener("failed", () => {
      src.close();
      void reconcile();
    });

    return () => {
      cancelled = true;
      src.close();
    };
  }, [run.id, state, router]);

  async function resume() {
    if (!run.datasetId) return;
    setResuming(true);
    setError(null);
    const r = await apiSend<Run>("/v1/runs", { datasetId: run.datasetId });
    setResuming(false);
    if (!r.ok) return setError(r.error);
    setState("QUEUED"); // re-arms the effect, which opens a fresh stream
  }

  const { stages, finished, failure } = foldEvents(events);
  const done = stages.size;
  const running = !TERMINAL(state);

  return (
    <section aria-label="Run progress" className="overflow-hidden rounded-[12px] border border-line-light bg-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-light px-5 py-3">
        <span
          aria-hidden="true"
          className={`h-[7px] w-[7px] rounded-full ${
            failure || state === "FAILED"
              ? "bg-refused"
              : running
                ? "animate-pulse bg-signal"
                : "bg-signal-deep"
          }`}
        />
        <span className="font-mono text-[11px] tracking-[0.1em] uppercase">{state}</span>
        <span className="font-mono text-[11px] text-ink-hush">
          {done} of {TIER_KEYS.length} tiers committed
        </span>
        {running ? (
          <span className="font-mono text-[10.5px] text-ink-hush">
            {live ? "streaming" : "reconnecting…"}
          </span>
        ) : null}
        {/* Progress is a real element, so a screen reader is told the same thing
            the dot says rather than nothing at all. */}
        <progress
          className="ml-auto h-[3px] w-[120px]"
          max={TIER_KEYS.length}
          value={done}
          aria-label={`${done} of ${TIER_KEYS.length} tiers`}
        />
      </div>

      <ol className="divide-y divide-line-light">
        {TIER_KEYS.map((key) => {
          const s = stages.get(key);
          return (
            <li
              key={key}
              className={`flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 ${s ? "" : "opacity-40"}`}
            >
              <TierBadge tier={key} />
              <span className="min-w-[200px] flex-1">
                <span className="block text-[13.5px]">{s?.label ?? "waiting"}</span>
                {s ? <span className="block font-mono text-[10.5px] text-ink-hush">{s.detail}</span> : null}
              </span>
              {s ? (
                <>
                  <span className="font-mono text-[12px] tnum">
                    {s.matchedRows.toLocaleString("en-IN")} rows
                  </span>
                  <span className="font-mono text-[11px] text-ink-hush">{s.committed} committed</span>
                  {s.escalated > 0 ? (
                    <span className="font-mono text-[11px] text-refused">{s.escalated} refused</span>
                  ) : null}
                </>
              ) : (
                <span className="font-mono text-[11px] text-ink-hush">—</span>
              )}
            </li>
          );
        })}
      </ol>

      {finished ? (
        <p className="border-t border-line-light bg-signal-wash px-5 py-3 font-mono text-[11.5px] text-signal-deep">
          {Number(finished.matchedRows).toLocaleString("en-IN")} of{" "}
          {Number(finished.totalRows).toLocaleString("en-IN")} rows matched ·{" "}
          {String(finished.autoMatchPct)}% · {String(finished.exceptions)} exceptions ·{" "}
          {String(finished.entries)} journal entries
        </p>
      ) : null}

      {failure || state === "FAILED" ? (
        <div className="border-t border-line-light bg-white px-5 py-4">
          <p className="font-mono text-[11.5px] text-refused">{failure ?? "the run failed"}</p>
          <p className="mt-1 max-w-[70ch] font-mono text-[10.5px] leading-relaxed text-ink-hush">
            Resuming re-runs from the last committed tier. Nothing posts twice: every link, event
            and journal entry carries a unique key and re-inserting one is a no-op.
          </p>
          <button
            onClick={resume}
            disabled={resuming}
            className="mt-3 border border-ink px-4 py-2 font-mono text-[11px] uppercase hover:bg-ink hover:text-on-ink disabled:opacity-30"
          >
            {resuming ? "resuming…" : "Resume run"}
          </button>
          {error ? <p className="mt-2 font-mono text-[11px] text-refused">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
