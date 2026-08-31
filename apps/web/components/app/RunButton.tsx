"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend, type Run } from "@/lib/api";

/**
 * Queues a close run.
 *
 * The 1,000-row cap this button used to enforce is gone: execution moved to the
 * worker in P3, so the request does two inserts and returns 202 rather than
 * holding a connection open until Render kills it. The size of the dataset is
 * no longer the browser's problem.
 */
export function RunButton({ datasetId, rows }: { datasetId: string; rows: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await apiSend<Run & { reused?: boolean }>("/v1/runs", { datasetId });
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    router.push(`/runs/${r.data.id}`);
  }

  return (
    <div className="text-right">
      <button
        onClick={run}
        disabled={busy}
        className="bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase transition-opacity hover:opacity-90 disabled:opacity-30"
      >
        {busy ? "queueing…" : "Close run"}
      </button>
      <p className="mt-2 max-w-[280px] font-mono text-[10.5px] leading-relaxed text-ink-hush">
        {rows.toLocaleString("en-IN")} rows run on the worker; the page follows the stream tier by
        tier.
      </p>
      {error ? <p className="mt-2 max-w-[280px] font-mono text-[11px] text-refused">{error}</p> : null}
    </div>
  );
}
