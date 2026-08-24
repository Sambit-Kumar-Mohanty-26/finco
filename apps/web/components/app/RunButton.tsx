"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_BASE } from "@/lib/api";

const SYNC_CAP = 1000;

/**
 * Starts a synchronous close run.
 *
 * Above the cap the button refuses locally rather than letting the request die
 * on Render's HTTP timeout — a run dropped halfway leaves match links half
 * written, and there is no way to tell that from a finished run afterwards.
 * P3 moves execution to the worker and lifts the cap.
 */
export function RunButton({ datasetId, rows }: { datasetId: string; rows: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooBig = rows > SYNC_CAP;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `API responded ${r.status}`);
      router.push(`/runs/${body.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={run}
        disabled={busy || tooBig}
        title={tooBig ? `Synchronous runs are capped at ${SYNC_CAP} rows` : undefined}
        className="bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase transition-opacity hover:opacity-90 disabled:opacity-30"
      >
        {busy ? "reconciling…" : "Close run"}
      </button>
      {tooBig ? (
        <p className="mt-2 max-w-[280px] font-mono text-[10.5px] leading-relaxed text-ink-hush">
          {rows.toLocaleString("en-IN")} rows exceeds the {SYNC_CAP.toLocaleString("en-IN")}-row
          synchronous cap. P3 moves runs to the worker.
        </p>
      ) : null}
      {error ? <p className="mt-2 max-w-[280px] font-mono text-[11px] text-refused">{error}</p> : null}
    </div>
  );
}
