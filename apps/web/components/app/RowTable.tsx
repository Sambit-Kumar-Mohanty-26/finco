"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { formatINR, paise } from "@finco/core";

type Row = Record<string, unknown> & { id: string };
type Source = "recon" | "settlements" | "bank" | "erp";

const TABS: { key: Source; label: string }[] = [
  { key: "recon", label: "Recon rows" },
  { key: "settlements", label: "Settlements" },
  { key: "bank", label: "Bank lines" },
  { key: "erp", label: "ERP invoices" },
];

const COLUMNS: Record<Source, { key: string; label: string; money?: boolean }[]> = {
  recon: [
    { key: "entityId", label: "Entity" },
    { key: "type", label: "Type" },
    { key: "settlementRef", label: "Settlement" },
    { key: "orderId", label: "Order" },
    { key: "creditPaise", label: "Credit", money: true },
    { key: "debitPaise", label: "Debit", money: true },
  ],
  settlements: [
    { key: "ref", label: "Settlement" },
    { key: "utr", label: "UTR" },
    { key: "settledOn", label: "Settled" },
    { key: "amountPaise", label: "Amount", money: true },
    { key: "onHold", label: "On hold" },
  ],
  bank: [
    { key: "ref", label: "Line" },
    { key: "valueDate", label: "Value date" },
    { key: "creditPaise", label: "Credit", money: true },
    { key: "chargesPaise", label: "Charges", money: true },
    { key: "narration", label: "Narration" },
  ],
  erp: [
    { key: "invoiceNo", label: "Invoice" },
    { key: "orderReceipt", label: "Order receipt" },
    { key: "invoiceDate", label: "Date" },
    { key: "amountPaise", label: "Amount", money: true },
  ],
};

/**
 * Cursor-paginated infinite scroll rather than a virtualiser.
 *
 * The API already has to expose keyset pagination for 50,000 rows, so reusing
 * it means the browser never holds more than what has been scrolled to — which
 * beats shipping every row and then hiding most of them. The sentinel loads the
 * next page when it comes into view.
 *
 * ponytail: `content-visibility: auto` covers the render cost of what IS in the
 * DOM. If a screen ever needs to jump straight to row 40,000, that is when
 * @tanstack/react-virtual earns its place — not before.
 *
 * The first page is fetched on the server and handed in as props, so the table
 * is in the SSR HTML and there is no mount effect at all. Every later fetch is
 * driven by an event — a tab click, a keystroke, or the sentinel scrolling into
 * view — which is also why no setState ever runs in an effect body here.
 */
export function RowTable({
  datasetId,
  initialRows,
  initialCursor,
}: {
  datasetId: string;
  initialRows: Row[];
  initialCursor: string | null;
}) {
  const [source, setSource] = useState<Source>("recon");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [done, setDone] = useState(initialCursor === null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No setState before the first await, so this is safe to call from an effect.
  const load = useCallback(
    async (reset: boolean, from: string | null, src: Source, query: string) => {
      try {
        const p = new URLSearchParams({ source: src, limit: "200" });
        if (from) p.set("cursor", from);
        if (query.trim()) p.set("q", query.trim());
        const r = await fetch(`${API_BASE}/v1/datasets/${datasetId}/rows?${p}`);
        if (!r.ok) throw new Error(`API responded ${r.status}`);
        const data = (await r.json()) as { rows: Row[]; nextCursor: string | null };
        setError(null);
        setRows((prev) => (reset ? data.rows : [...prev, ...data.rows]));
        setCursor(data.nextCursor);
        setDone(data.nextCursor === null);
      } catch (e) {
        setError((e as Error).message);
        setDone(true);
      } finally {
        setLoading(false);
      }
    },
    [datasetId],
  );

  function restart(src: Source, query: string) {
    setRows([]);
    setCursor(null);
    setDone(false);
    setLoading(true);
    void load(true, null, src, query);
  }

  function changeSource(next: Source) {
    if (next === source) return;
    setSource(next);
    restart(next, q);
  }

  function changeQuery(next: string) {
    setQ(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => restart(source, next), 250);
  }

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || loading || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setLoading(true);
          void load(false, cursor, source, q);
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, done, loading, load, source, q]);

  const cols = COLUMNS[source];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-light pb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => changeSource(t.key)}
            className={`px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] transition-colors ${
              source === t.key
                ? "bg-ink text-on-ink"
                : "border border-line-light text-ink-hush hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="filter…"
          aria-label="Filter rows"
          className="ml-auto w-[220px] border border-line-light px-3 py-1.5 font-mono text-[11px] outline-none focus:border-ink"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`border-b border-line-light py-2.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-hush uppercase ${
                    c.money ? "text-right" : "text-left"
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="[contain-intrinsic-size:auto_34px] [content-visibility:auto]"
              >
                {cols.map((c) => (
                  <Cell key={c.key} value={r[c.key]} money={c.money} extra={r.parsed} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="py-6 font-mono text-[12px] text-refused">{error}</p>
      ) : rows.length === 0 && !loading ? (
        <p className="py-10 text-center font-mono text-[12px] text-ink-hush">
          {q ? `Nothing matches “${q}”.` : "No rows in this source."}
        </p>
      ) : null}

      <div ref={sentinel} className="py-6 text-center font-mono text-[11px] text-ink-hush">
        {loading ? "loading…" : done && rows.length > 0 ? `${rows.length} rows · end of list` : ""}
      </div>
    </div>
  );
}

function Cell({ value, money, extra }: { value: unknown; money?: boolean; extra?: unknown }) {
  if (money) {
    return (
      <td className="border-b border-line-light py-2 text-right font-mono text-[12px] tnum">
        {BigInt(String(value ?? "0")) === 0n ? (
          <span className="text-ink-hush">0.00</span>
        ) : (
          formatINR(paise(String(value)))
        )}
      </td>
    );
  }
  const isNarration = typeof value === "string" && value.length > 30;
  const parsed = extra as { utr: string | null; format: string } | undefined;
  return (
    <td className="max-w-[380px] truncate border-b border-line-light py-2 pr-4 font-mono text-[12px] text-ink">
      {value === null || value === undefined || value === "" ? (
        <span className="text-ink-hush">—</span>
      ) : typeof value === "boolean" ? (
        value ? (
          "yes"
        ) : (
          "no"
        )
      ) : (
        String(value)
      )}
      {isNarration && parsed ? (
        <span
          className={`ml-2 font-mono text-[10px] ${parsed.utr ? "text-signal-deep" : "text-refused"}`}
        >
          {parsed.utr ? `${parsed.format} ✓` : "no UTR"}
        </span>
      ) : null}
    </td>
  );
}
