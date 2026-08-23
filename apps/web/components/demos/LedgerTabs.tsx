"use client";

import { useId, useRef, useState } from "react";
import { Money } from "@/components/money/Money";
import { journalEntry } from "@/lib/fixtures/landing.ts";
import {
  EXCEPTIONS,
  EXCEPTIONS_TOTAL,
  TRIAL_BALANCE,
  TRIAL_TOTAL,
} from "@/lib/fixtures/ledger.ts";

/**
 * C4 — the ledger, in three views.
 *
 * Content translates as the tab changes, the fadeInTabTranslate pattern at
 * 300ms. A real tablist: roving tabindex, arrow keys, Home/End, correct
 * aria-controls. Muscle memory beats cleverness here.
 */
const TABS = [
  { key: "journal", label: "Journal entry" },
  { key: "trial", label: "Trial balance" },
  { key: "exceptions", label: "Exceptions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function LedgerTabs() {
  const [active, setActive] = useState<TabKey>("journal");
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const last = TABS.length - 1;
    let next = -1;
    if (e.key === "ArrowRight") next = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft") next = i === 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next < 0) return;
    e.preventDefault();
    setActive(TABS[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div className="overflow-hidden rounded-[12px] border border-line-light bg-white">
      <div
        role="tablist"
        aria-label="Ledger views"
        className="flex border-b border-line-light"
      >
        {TABS.map((t, i) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`relative px-5 py-4 font-mono text-[11.5px] tracking-[0.04em] transition-colors duration-[--dur-micro] ease-[var(--ease-ui)] ${
                selected
                  ? "text-on-paper"
                  : "text-on-paper-hush hover:text-on-paper"
              }`}
            >
              {t.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-3 bottom-0 h-[2px] origin-left bg-signal transition-transform duration-[--dur-ui] ease-[var(--ease-ui)] ${
                  selected ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      {TABS.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`${baseId}-panel-${t.key}`}
          aria-labelledby={`${baseId}-tab-${t.key}`}
          hidden={t.key !== active}
        >
          {t.key === active ? (
            <div
              style={{
                animation:
                  "slideUpAndFade var(--dur-ui) var(--ease-ui) both",
              }}
            >
              {t.key === "journal" ? <JournalView /> : null}
              {t.key === "trial" ? <TrialView /> : null}
              {t.key === "exceptions" ? <ExceptionsView /> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`border-b border-line-light px-5 py-3 font-mono text-[9.5px] font-semibold tracking-[0.12em] text-on-paper-hush uppercase ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function JournalView() {
  return (
    <>
      <div className="scroll-x">
        <table className="w-full min-w-[520px] border-collapse text-[13.5px]">
          <caption className="sr-only">{journalEntry.narration}</caption>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th align="right">Debit</Th>
              <Th align="right">Credit</Th>
            </tr>
          </thead>
          <tbody>
            {journalEntry.lines.map((l) => (
              <tr key={l.account}>
                <th
                  scope="row"
                  className="border-b border-line-light px-5 py-3 text-left font-mono text-[12px] font-normal text-on-paper"
                >
                  {l.account}
                </th>
                <td className="border-b border-line-light px-5 py-3 text-right">
                  <Money paise={l.debit} tone={l.debit === 0n ? "hush" : "inherit"} className="text-[12.5px]" />
                </td>
                <td className="border-b border-line-light px-5 py-3 text-right">
                  <Money paise={l.credit} tone={l.credit === 0n ? "hush" : "inherit"} className="text-[12.5px]" />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-5 py-4 text-left font-mono text-[10px] tracking-[0.12em] text-on-paper-hush uppercase">
                Total
              </th>
              <td className="px-5 py-4 text-right">
                <Money paise={journalEntry.totalDebit} className="text-[13px] font-medium" />
              </td>
              <td className="px-5 py-4 text-right">
                <Money paise={journalEntry.totalCredit} className="text-[13px] font-medium" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Footer
        ok
        label="BALANCED"
        note={`debits equal credits · identity delta ${journalEntry.identityDelta.toString()} · tier ${journalEntry.tier}`}
      />
    </>
  );
}

function TrialView() {
  return (
    <>
      <div className="scroll-x">
        <table className="w-full min-w-[520px] border-collapse text-[13.5px]">
          <caption className="sr-only">Trial balance as at 11 June 2026</caption>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th align="right">Debit</Th>
              <Th align="right">Credit</Th>
            </tr>
          </thead>
          <tbody>
            {TRIAL_BALANCE.map((r) => (
              <tr key={r.account} className={r.flag ? "bg-refused/[0.07]" : undefined}>
                <th
                  scope="row"
                  className={`border-b border-line-light px-5 py-3 text-left font-mono text-[12px] font-normal ${
                    r.flag ? "text-refused" : "text-on-paper"
                  }`}
                >
                  {r.account}
                </th>
                <td className="border-b border-line-light px-5 py-3 text-right">
                  <Money paise={r.debit} tone={r.debit === 0n ? "hush" : r.flag ? "refused" : "inherit"} className="text-[12.5px]" />
                </td>
                <td className="border-b border-line-light px-5 py-3 text-right">
                  <Money paise={r.credit} tone={r.credit === 0n ? "hush" : "inherit"} className="text-[12.5px]" />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-5 py-4 text-left font-mono text-[10px] tracking-[0.12em] text-on-paper-hush uppercase">
                Total
              </th>
              <td className="px-5 py-4 text-right">
                <Money paise={TRIAL_TOTAL.debit} className="text-[13px] font-medium" />
              </td>
              <td className="px-5 py-4 text-right">
                <Money paise={TRIAL_TOTAL.credit} className="text-[13px] font-medium" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Footer
        ok
        label="BALANCED"
        note="9999 suspense is the honest exception list, in rupees"
      />
    </>
  );
}

function ExceptionsView() {
  return (
    <>
      <div className="scroll-x">
        <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
          <caption className="sr-only">Open exceptions by class</caption>
          <thead>
            <tr>
              <Th>Class</Th>
              <Th>Owner</Th>
              <Th align="right">Items</Th>
              <Th align="right">Value</Th>
              <Th align="right">Verdict</Th>
            </tr>
          </thead>
          <tbody>
            {EXCEPTIONS.map((e) => (
              <tr key={e.code}>
                <th scope="row" className="border-b border-line-light px-5 py-3 text-left font-normal">
                  <span className="font-mono text-[12px] text-on-paper">{e.code}</span>{" "}
                  <span className="text-[13px] text-on-paper-hush">{e.name}</span>
                </th>
                <td className="border-b border-line-light px-5 py-3 font-mono text-[11px] text-on-paper-hush">
                  {e.owner}
                </td>
                <td className="border-b border-line-light px-5 py-3 text-right font-mono text-[12px] tnum text-on-paper-hush">
                  {e.items}
                </td>
                <td className="border-b border-line-light px-5 py-3 text-right">
                  <Money paise={e.value} className="text-[12.5px]" />
                </td>
                <td className="border-b border-line-light px-5 py-3 text-right">
                  <Verdict kind={e.verdict} />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-5 py-4 text-left font-mono text-[10px] tracking-[0.12em] text-on-paper-hush uppercase">
                Total unproven
              </th>
              <td />
              <td className="px-5 py-4 text-right font-mono text-[13px] tnum">
                {EXCEPTIONS_TOTAL.items}
              </td>
              <td className="px-5 py-4 text-right">
                <Money paise={EXCEPTIONS_TOTAL.value} tone="refused" className="text-[13px] font-medium" />
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <Footer
        label="9999 SUSPENSE"
        note="every unproven rupee parks here with an owner and an age"
      />
    </>
  );
}

function Verdict({ kind }: { kind: "escalate" | "proven" | "blocked" }) {
  const map = {
    proven: { label: "PROVEN", cls: "border-proven text-proven" },
    escalate: { label: "ESCALATE", cls: "border-refused text-refused" },
    blocked: { label: "BLOCKED", cls: "border-proposed text-proposed" },
  } as const;
  const v = map[kind];
  return (
    <span className={`border px-2 py-[2px] font-mono text-[9.5px] font-semibold tracking-[0.08em] ${v.cls}`}>
      {v.label}
    </span>
  );
}

function Footer({
  ok = false,
  label,
  note,
}: {
  ok?: boolean;
  label: string;
  note: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line-light bg-paper-cool px-5 py-3.5">
      <span
        className={`border px-2 py-[2px] font-mono text-[9.5px] font-semibold tracking-[0.08em] ${
          ok ? "border-signal-deep text-signal-deep" : "border-refused text-refused"
        }`}
      >
        {label}
      </span>
      <span className="font-mono text-[10.5px] text-on-paper-hush">{note}</span>
    </div>
  );
}
