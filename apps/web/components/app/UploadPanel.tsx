"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_BASE } from "@/lib/api";
import { SCHEMAS, detectMapping, parseCsv, periodOf, toBundleRows, type Kind } from "@/lib/csv";

/**
 * CSV upload — the only ingest that works for every source.
 *
 * A gateway has an API; a bank does not. Indian net banking gives you a CSV and
 * nothing else, and the bank side is half of the identity that proves a
 * settlement landed. So this is not the fallback path, it is the one that has
 * to work, and the API pull is an accelerator on one source out of four.
 *
 * Parsing happens here rather than on the server: the file becomes the same
 * JSON bundle `POST /v1/datasets` already takes, so there is no multipart
 * handler, no upload storage and no second ingest path to keep in step.
 */

const SLOTS: { kind: Kind; label: string; hint: string; required?: boolean }[] = [
  { kind: "settlements", label: "Settlements", hint: "Razorpay → Settlements → download", required: true },
  { kind: "reconRows", label: "Transactions", hint: "Razorpay → Settlements → recon report", required: true },
  { kind: "bankLines", label: "Bank statement", hint: "Net banking → statement as CSV" },
  { kind: "erpInvoices", label: "ERP invoices", hint: "Tally or Zoho invoice export" },
];

const DATE_KEY: Record<Kind, string> = {
  settlements: "settledOn",
  reconRows: "capturedOn",
  bankLines: "valueDate",
  erpInvoices: "invoiceDate",
};

type Slot = {
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: Record<string, string | null>;
  error: string | null;
};

export function UploadPanel() {
  const router = useRouter();
  const [slots, setSlots] = useState<Partial<Record<Kind, Slot>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(kind: Kind, file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.headers.length === 0) throw new Error("no header row");
      setSlots((s) => ({
        ...s,
        [kind]: {
          fileName: file.name,
          headers: parsed.headers,
          rows: parsed.rows,
          mapping: detectMapping(parsed.headers, kind),
          error: null,
        },
      }));
    } catch (e) {
      setError(`${file.name}: ${(e as Error).message}`);
    }
  }

  function remap(kind: Kind, field: string, header: string) {
    setSlots((s) => {
      const slot = s[kind];
      if (!slot) return s;
      return { ...s, [kind]: { ...slot, mapping: { ...slot.mapping, [field]: header || null } } };
    });
  }

  async function upload() {
    setBusy(true);
    setError(null);
    try {
      // Convert every slot BEFORE posting anything. A file that fails on row
      // 4,000 should not leave three of four sources already ingested.
      const bundle: Record<string, Record<string, unknown>[]> = {};
      let period: string | null = null;
      for (const { kind } of SLOTS) {
        const slot = slots[kind];
        if (!slot) continue;
        const rows = toBundleRows({ headers: slot.headers, rows: slot.rows }, kind, slot.mapping);
        bundle[kind] = rows;
        period = period ?? periodOf(rows, DATE_KEY[kind]);
      }

      const r = await fetch(`${API_BASE}/v1/datasets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...bundle,
          period: period ?? new Date().toISOString().slice(0, 7),
          name: `Upload · ${period ?? "unknown period"}`,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `API responded ${r.status}`);
      setSlots({});
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(slots.settlements && slots.reconRows);
  const unmapped = SLOTS.flatMap(({ kind }) => {
    const slot = slots[kind];
    if (!slot) return [];
    return SCHEMAS[kind].filter((f) => f.required && !slot.mapping[f.key]).map((f) => `${kind}.${f.key}`);
  });

  return (
    <section className="border border-line-light p-6">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-hush">Upload CSVs</h2>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-[1.65] text-ink-soft">
        No credentials, no integration. Export what you already have — a gateway
        settlement report, a bank statement, an invoice register — and drop the
        files here. Columns are matched by name and anything unrecognised is a
        dropdown, not a support ticket.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SLOTS.map(({ kind, label, hint, required }) => {
          const slot = slots[kind];
          return (
            <div key={kind} className="border border-line-light p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] tracking-[0.04em]">
                  {label}
                  {required ? <span className="text-refused"> *</span> : null}
                </span>
                {slot ? (
                  <span className="font-mono text-[10.5px] text-ink-hush">
                    {slot.rows.length.toLocaleString("en-IN")} rows
                  </span>
                ) : null}
              </div>
              <p className="mt-1 font-mono text-[10.5px] text-ink-hush">{slot?.fileName ?? hint}</p>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => pick(kind, e.target.files?.[0])}
                className="mt-3 block w-full font-mono text-[10.5px] text-ink-soft file:mr-3 file:border file:border-ink file:bg-transparent file:px-3 file:py-1 file:font-mono file:text-[10.5px] file:text-ink hover:file:bg-ink hover:file:text-on-ink"
              />

              {/* Only required fields that failed to match are asked about. Showing
                  every column as a dropdown turns a ten-second task into a form. */}
              {slot
                ? SCHEMAS[kind]
                    .filter((f) => f.required && !slot.mapping[f.key])
                    .map((f) => (
                      <label key={f.key} className="mt-3 block">
                        <span className="font-mono text-[10.5px] text-refused">
                          which column is {f.key}?
                        </span>
                        <select
                          value={slot.mapping[f.key] ?? ""}
                          onChange={(e) => remap(kind, f.key, e.target.value)}
                          className="mt-1 w-full border border-line-light bg-transparent px-2 py-1 font-mono text-[11px]"
                        >
                          <option value="">— pick a column —</option>
                          {slot.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))
                : null}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          onClick={upload}
          disabled={busy || !ready || unmapped.length > 0}
          className="border border-ink px-4 py-2 font-mono text-[11px] tracking-[0.04em] transition-colors hover:bg-ink hover:text-on-ink disabled:opacity-40"
        >
          {busy ? "ingesting…" : "Ingest"}
        </button>
        <p className="font-mono text-[10.5px] text-ink-hush">
          {!ready
            ? "settlements and transactions are both required"
            : unmapped.length > 0
              ? `still unmapped: ${unmapped.join(", ")}`
              : "the period is read from the dates in the files"}
        </p>
      </div>

      {error ? <p className="mt-3 font-mono text-[11px] text-refused">{error}</p> : null}
    </section>
  );
}
