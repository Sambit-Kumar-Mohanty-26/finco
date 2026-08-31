"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { paise } from "@finco/core";
import { Money } from "@/components/money/Money";
import { UndoToast } from "@/components/app/UndoToast";
import { apiSend, type Exception } from "@/lib/api";
import { bulkBlockReason } from "@/lib/review";

/**
 * The exception queue.
 *
 * Built for somebody who does this for two hours every month-end, which means
 * the keyboard is the primary interface and the mouse is the fallback. The set
 * is small enough to hold in muscle memory and is printed on the screen rather
 * than hidden in a help modal nobody opens.
 *
 * The bulk bar states the SPECIFIC reason it is unavailable — "the selection
 * mixes E02 and E03" — instead of greying itself out. A disabled control with
 * no explanation is the single most common way software wastes a person's
 * afternoon, and the API already computes the reason, so refusing to show it
 * would be a deliberate omission.
 *
 * Nothing here is optimistic. A row changes state after the API says it did,
 * never before: this is a posting to a general ledger, and a UI that shows a
 * resolution that did not happen is worse than a UI that is briefly slow.
 */

const KEYS = [
  ["j", "next"],
  ["k", "previous"],
  ["x", "select"],
  ["a", "approve selection"],
  ["e", "open resolver"],
  ["r", "reopen"],
  ["u", "undo"],
] as const;

type Undo = { message: string; ids: string[] };

export function ExceptionQueue({ rows }: { rows: Exception[] }) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const at = rows[cursor];

  /** Reopen is the reversal path: it is also what the undo toast calls. */
  const reopen = useCallback(
    async (ids: string[]) => {
      setBusy(true);
      for (const id of ids) {
        const r = await apiSend(`/v1/exceptions/${id}/reopen`);
        if (!r.ok) setProblem(r.error);
      }
      setBusy(false);
      router.refresh();
    },
    [router],
  );

  const approve = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return setProblem("Select something first — x toggles the row.");
    setBusy(true);
    setProblem(null);
    const r = await apiSend<{ resolved: number; code: string; account: string }>(
      "/v1/exceptions/bulk-approve",
      { ids },
    );
    setBusy(false);
    if (!r.ok) {
      // `reason` is the API's specific explanation; `error` is the headline.
      setProblem(r.detail.reason ? `${r.error} — ${String(r.detail.reason)}` : r.error);
      return;
    }
    setSelected(new Set());
    setUndo({
      message: `${r.data.resolved} ${r.data.code} reclassed to ${r.data.account}`,
      ids,
    });
    router.refresh();
  }, [selected, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal a key from a field somebody is typing in.
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      const move = (d: number) => {
        e.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, Math.max(0, c + d)));
      };
      const row = rows[cursor];

      switch (e.key) {
        case "j":
          return move(1);
        case "k":
          return move(-1);
        case "x":
          if (!row) return;
          e.preventDefault();
          return setSelected((s) => {
            const next = new Set(s);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            return next;
          });
        case "a":
          e.preventDefault();
          return void approve();
        case "e":
          if (!row) return;
          e.preventDefault();
          return router.push(`/exceptions/${row.id}`);
        case "r":
          if (!row) return;
          e.preventDefault();
          if (row.status !== "RESOLVED") return setProblem("Only a resolved exception can be reopened.");
          return void reopen([row.id]);
        case "u":
          e.preventDefault();
          if (!undo) return setProblem("Nothing to undo.");
          return void reopen(undo.ids).then(() => setUndo(null));
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, approve, reopen, router, undo]);

  useEffect(() => {
    itemRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const chosen = rows.filter((r) => selected.has(r.id));
  const codes = [...new Set(chosen.map((r) => r.code))];
  const blocked = bulkBlockReason(chosen);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {KEYS.map(([k, what]) => (
          <span key={k} className="font-mono text-[10.5px] text-ink-hush">
            <kbd className="border border-line-light px-1 text-ink">{k}</kbd> {what}
          </span>
        ))}
      </div>

      <ul className="overflow-hidden rounded-[12px] border border-line-light bg-white">
        {rows.length === 0 ? (
          <li className="px-6 py-14 text-center">
            <p className="text-[16px]">Nothing open.</p>
            <p className="mt-2 font-mono text-[12px] text-ink-hush">
              Every exception in this run has been resolved or reclassed.
            </p>
          </li>
        ) : (
          rows.map((r, i) => {
            const on = selected.has(r.id);
            return (
              <li
                key={r.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                aria-current={i === cursor ? "true" : undefined}
                onClick={() => setCursor(i)}
                className={`flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-light px-5 py-3 last:border-b-0 ${
                  i === cursor ? "bg-paper-cool" : ""
                } ${on ? "border-l-2 border-l-signal-deep" : "border-l-2 border-l-transparent"}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                  aria-label={`select ${r.subjectRef}`}
                  className="accent-[var(--color-signal-deep)]"
                />
                <span className="w-[132px] shrink-0 font-mono text-[10.5px] tracking-[0.06em] text-ink-hush">
                  {r.code}
                </span>
                <span className="min-w-[180px] flex-1">
                  <span className="block font-mono text-[12px]">{r.subjectRef}</span>
                  <span className="block max-w-[62ch] font-mono text-[10.5px] text-ink-hush">
                    {r.reason}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] text-ink-hush">
                  {r.spec?.owner ?? "Ops"} · parks {r.parksTo}
                </span>
                <Money paise={paise(r.amountPaise)} className="text-[12px]" />
                <span
                  className={`w-[70px] text-right font-mono text-[10.5px] ${
                    r.status === "OPEN" ? "text-refused" : "text-signal-deep"
                  }`}
                >
                  {r.status}
                </span>
                <a
                  href={`/exceptions/${r.id}`}
                  className="font-mono text-[10.5px] text-ink-hush underline hover:text-ink"
                >
                  open
                </a>
              </li>
            );
          })
        )}
      </ul>

      {/* the bulk bar — present as soon as anything is selected, and it says why
          it cannot act rather than going grey and silent */}
      {selected.size > 0 ? (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] border border-line-light bg-white px-5 py-3 shadow-[var(--shadow-card)]">
          <span className="font-mono text-[12px]">{selected.size} selected</span>
          {blocked ? (
            <span className="max-w-[60ch] font-mono text-[11px] text-refused">{blocked}</span>
          ) : (
            <span className="font-mono text-[11px] text-ink-hush">
              all {codes[0]} · auto-resolvable · parks to {chosen[0]?.parksTo}
            </span>
          )}
          <button
            onClick={approve}
            disabled={busy || blocked !== null}
            className="ml-auto bg-ink px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase disabled:opacity-30"
          >
            {busy ? "posting…" : "Approve"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="border border-line-light px-3 py-2 font-mono text-[11px] uppercase hover:bg-paper"
          >
            Clear
          </button>
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-3 max-w-[76ch] font-mono text-[11.5px] text-refused">
          {problem}
        </p>
      ) : null}

      {undo ? (
        <UndoToast
          message={undo.message}
          onUndo={() => reopen(undo.ids)}
          onDismiss={() => setUndo(null)}
        />
      ) : null}

      {at ? (
        <p className="mt-3 font-mono text-[10.5px] text-ink-hush">
          cursor on {at.subjectRef} — press e to open it
        </p>
      ) : null}
    </div>
  );
}
