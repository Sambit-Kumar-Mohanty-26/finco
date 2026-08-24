"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_BASE } from "@/lib/api";

/**
 * Seeds a scenario from the deterministic generator.
 *
 * The same seed always produces the same data, so a run over a seeded dataset
 * has a known answer key — which is what makes the match rate a control rather
 * than a claim.
 */
export function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function seed(rows: number) {
    setBusy(rows);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/v1/datasets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generate: rows, name: `Seeded scenario · ${rows} rows` }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `API responded ${r.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="text-right">
      <div className="flex gap-2">
        {[50, 500, 5000].map((n) => (
          <button
            key={n}
            onClick={() => seed(n)}
            disabled={busy !== null}
            className="border border-ink px-4 py-2 font-mono text-[11px] tracking-[0.04em] transition-colors hover:bg-ink hover:text-on-ink disabled:opacity-40"
          >
            {busy === n ? "seeding…" : `Seed ${n.toLocaleString("en-IN")}`}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 font-mono text-[11px] text-refused">{error}</p> : null}
    </div>
  );
}
