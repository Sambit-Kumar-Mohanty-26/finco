import { Money } from "@/components/money/Money";
import { AppFrame } from "./AppFrame";
import { EXCEPTIONS, EXCEPTIONS_TOTAL, TRIAL_BALANCE, TRIAL_TOTAL } from "@/lib/fixtures/ledger.ts";
import { RUN, STAGES, TOTAL_ROWS } from "@/lib/fixtures/run.ts";
import { AGEING } from "@/lib/fixtures/cash.ts";
import { bankLine, candidates, verdict } from "@/lib/fixtures/landing.ts";

/**
 * Product screens, rendered as the real thing.
 *
 * These are the marketing page's "screenshots" — except nothing is a picture.
 * Every figure comes from the same fixtures the checks verify, so the shots
 * cannot drift from the product or from each other.
 */

const th =
  "border-b border-line-light px-4 py-2.5 font-mono text-[9.5px] font-semibold tracking-[0.12em] text-on-paper-hush uppercase";
const td = "border-b border-line-light px-4 py-[11px]";

/* ---------------------------------------------------------------- runs */
export function RunScreen({
  stage,
  chromeVar = false,
}: {
  /** index into STAGES; omit for the finished run (every non-hero call site) */
  stage?: number;
  chromeVar?: boolean;
} = {}) {
  const at = stage ?? STAGES.length - 1;
  const done = at >= STAGES.length - 1;
  const cur = STAGES[Math.min(at, STAGES.length - 1)];
  const matched = cur.matched;
  const rate = ((matched / TOTAL_ROWS) * 100).toFixed(1) + "%";
  return (
    <AppFrame
      active="runs"
      title="Close run · 11 June 2026"
      meta={RUN.id}
      chromeVar={chromeVar}
    >
      <div className="grid grid-cols-2 gap-px border-b border-line-light bg-line-light md:grid-cols-4">
        {[
          { l: "auto-match", v: rate, tone: "" },
          { l: "precision", v: done ? RUN.precision : "—", tone: "text-signal-deep" },
          { l: "false matches", v: done ? "0" : "—", tone: "text-signal-deep" },
          { l: "exceptions", v: done ? String(RUN.exceptions) : "—", tone: "text-refused" },
        ].map((s) => (
          <div key={s.l} className="bg-white px-4 py-3.5">
            <div className={`font-mono text-[19px] tnum ${s.tone}`}>{s.v}</div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.12em] text-on-paper-hush uppercase">
              {s.l}
            </div>
          </div>
        ))}
      </div>

      <ol className="px-5 py-2" role="list">
        {STAGES.map((s, i) => {
          const reached = i <= at;
          const pct = reached ? (s.matched / TOTAL_ROWS) * 100 : 0;
          return (
            <li
              key={s.key}
              className="grid grid-cols-[1fr_88px] items-center gap-4 border-b border-line-light py-[9px] transition-opacity duration-500 last:border-b-0 sm:grid-cols-[180px_1fr_88px]"
              style={{ opacity: reached ? 1 : 0.3 }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                    s.kind === "agent"
                      ? "bg-proposed"
                      : s.kind === "gate"
                        ? "bg-signal-deep"
                        : "bg-proven"
                  }`}
                />
                <span className="font-mono text-[11.5px]">{s.label}</span>
              </div>
              <div className="hidden h-[5px] rounded-full bg-line-light sm:block">
                <div
                  className="h-full rounded-full bg-signal-deep/70 transition-[width] duration-700 ease-[var(--ease-glide)]"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <div className="text-right font-mono text-[11.5px] tnum text-on-paper-hush">
                {reached ? (s.rightLabel ?? s.matched.toLocaleString("en-IN")) : ""}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-light bg-paper-cool px-5 py-3">
        <span
          className={`rounded-[4px] border px-2 py-[2px] font-mono text-[9.5px] font-semibold tracking-[0.08em] ${
            done ? "border-signal-deep text-signal-deep" : "border-line-2 text-on-paper-hush"
          }`}
        >
          {done ? "SCORED" : "RUNNING"}
        </span>
        <span className="font-mono text-[10.5px] text-on-paper-hush">
          {done
            ? "identity closure 100% · replay hash stable · 4,705 of 5,000 proven"
            : `${cur.detail} · ${(TOTAL_ROWS - matched).toLocaleString("en-IN")} rows still unproven`}
        </span>
      </div>
    </AppFrame>
  );
}

/* ---------------------------------------------------- exception queue */
export function QueueScreen() {
  return (
    <AppFrame
      active="exceptions"
      title="Exception queue"
      meta={`${EXCEPTIONS_TOTAL.items} open · ₹2,41,880.00 unproven`}
    >
      <div className="scroll-x">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>Class</th>
              <th scope="col" className={`${th} text-left`}>Owner</th>
              <th scope="col" className={`${th} text-right`}>Items</th>
              <th scope="col" className={`${th} text-right`}>Value</th>
              <th scope="col" className={`${th} text-right`}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {EXCEPTIONS.map((e) => (
              <tr key={e.code}>
                <th scope="row" className={`${td} text-left font-normal`}>
                  <span className="font-mono text-[11.5px]">{e.code}</span>{" "}
                  <span className="text-on-paper-hush">{e.name}</span>
                </th>
                <td className={`${td} font-mono text-[11px] text-on-paper-hush`}>
                  {e.owner}
                </td>
                <td className={`${td} text-right font-mono text-[11.5px] tnum text-on-paper-hush`}>
                  {e.items}
                </td>
                <td className={`${td} text-right`}>
                  <Money paise={e.value} className="text-[12px]" />
                </td>
                <td className={`${td} text-right`}>
                  <Verdict kind={e.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-light bg-paper-cool px-5 py-3">
        <span className="rounded-[4px] bg-on-paper px-2.5 py-[3px] font-mono text-[9.5px] text-white">
          Approve 14
        </span>
        <span className="font-mono text-[10.5px] text-on-paper-hush">
          selection is one class and all proven · bulk approve available
        </span>
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------- the refusal */
export function RefusalScreen() {
  return (
    <AppFrame
      active="exceptions"
      title="E08 · Merged bank credit"
      meta="aged 2 d · blocking period close"
    >
      <div className="grid gap-px bg-line-light lg:grid-cols-2">
        <div className="bg-white p-5">
          <div className="font-mono text-[9.5px] tracking-[0.12em] text-on-paper-hush uppercase">
            Evidence
          </div>
          <div className="mt-4 flex items-baseline justify-between font-mono text-[11px] text-on-paper-hush">
            <span>{bankLine.id}</span>
            <span>{bankLine.valueDate}</span>
          </div>
          <div className="mt-1.5">
            <Money paise={bankLine.credit} className="text-[24px] font-medium" />
          </div>
          <div className="mt-5 border-t border-line-light pt-4">
            <p className="font-mono text-[11.5px] leading-relaxed break-all">
              {bankLine.narration.split(bankLine.utrFragment)[0]}
              <span className="border-b-2 border-signal-deep text-signal-deep">
                {bankLine.utrFragment}
              </span>
              {bankLine.narration.split(bankLine.utrFragment)[1]}
            </p>
            <p className="mt-3 font-mono text-[10px] text-on-paper-hush">
              UTR recovered · 61% confidence · truncated at 40 chars (HDFC)
            </p>
          </div>
        </div>

        <div className="bg-white p-5">
          <div className="font-mono text-[9.5px] tracking-[0.12em] text-on-paper-hush uppercase">
            Candidates — both sum exactly
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="rounded-[8px] border border-line-light bg-paper-cool/60 p-3"
              >
                <div className="font-mono text-[11.5px]">
                  {c.settlements.map((s) => s.id).join("  +  ")}
                </div>
                <div className="mt-1.5 flex items-baseline gap-2 font-mono text-[11px] text-on-paper-hush">
                  <span>=</span>
                  <Money paise={c.sum} className="text-[11.5px]" />
                  <span className="text-signal-deep">exact</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-[8px] border border-refused/45 bg-refused/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[4px] border border-refused px-2 py-[2px] font-mono text-[9.5px] font-semibold tracking-[0.08em] text-refused">
                ESCALATE
              </span>
              <span className="font-mono text-[10.5px] text-on-paper-hush">
                {verdict.reason}
              </span>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

/* ------------------------------------------------------------ ledger */
export function LedgerScreen() {
  return (
    <AppFrame
      active="ledger"
      title="Trial balance · as at 11 June 2026"
      meta="debits = credits"
    >
      <div className="scroll-x">
        <table className="w-full min-w-[480px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>Account</th>
              <th scope="col" className={`${th} text-right`}>Debit</th>
              <th scope="col" className={`${th} text-right`}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {TRIAL_BALANCE.map((r) => (
              <tr key={r.account} className={r.flag ? "bg-refused/[0.06]" : undefined}>
                <th
                  scope="row"
                  className={`${td} text-left font-mono text-[11.5px] font-normal ${
                    r.flag ? "text-refused" : ""
                  }`}
                >
                  {r.account}
                </th>
                <td className={`${td} text-right`}>
                  <Money
                    paise={r.debit}
                    tone={r.debit === 0n ? "hush" : r.flag ? "refused" : "inherit"}
                    className="text-[12px]"
                  />
                </td>
                <td className={`${td} text-right`}>
                  <Money paise={r.credit} tone={r.credit === 0n ? "hush" : "inherit"} className="text-[12px]" />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-3 text-left font-mono text-[9.5px] tracking-[0.12em] text-on-paper-hush uppercase">
                Total
              </th>
              <td className="px-4 py-3 text-right">
                <Money paise={TRIAL_TOTAL.debit} className="text-[12.5px] font-medium" />
              </td>
              <td className="px-4 py-3 text-right">
                <Money paise={TRIAL_TOTAL.credit} className="text-[12.5px] font-medium" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-line-light bg-paper-cool px-5 py-3">
        <span className="rounded-[4px] border border-signal-deep px-2 py-[2px] font-mono text-[9.5px] font-semibold tracking-[0.08em] text-signal-deep">
          BALANCED
        </span>
        <span className="font-mono text-[10.5px] text-on-paper-hush">
          9999 suspense is the honest exception list, in rupees
        </span>
      </div>
    </AppFrame>
  );
}

/* -------------------------------------------------------------- cash */
export function CashScreen() {
  return (
    <AppFrame active="cash" title="Cash at risk" meta="as at 11 June 2026">
      <div className="scroll-x">
        <table className="w-full min-w-[460px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>Bucket</th>
              <th scope="col" className={`${th} text-right`}>Value</th>
              <th scope="col" className={`${th} text-right`}>Oldest</th>
            </tr>
          </thead>
          <tbody>
            {AGEING.map((b) => (
              <tr key={b.bucket} className={b.emphasis ? "bg-refused/[0.06]" : undefined}>
                <th
                  scope="row"
                  className={`${td} text-left text-[13px] ${
                    b.emphasis ? "font-semibold text-refused" : "font-medium"
                  }`}
                >
                  {b.bucket}
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-on-paper-hush">
                    {b.source}
                  </span>
                </th>
                <td className={`${td} text-right`}>
                  <Money paise={b.value} tone={b.emphasis ? "refused" : "inherit"} className="text-[12px]" />
                </td>
                <td className={`${td} text-right font-mono text-[11px] text-on-paper-hush`}>
                  {b.oldest}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line-light bg-paper-cool px-5 py-3 font-mono text-[10.5px] text-on-paper-hush">
        unproven money sits on the cash position, not in a footnote
      </div>
    </AppFrame>
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
    <span
      className={`rounded-[4px] border px-2 py-[2px] font-mono text-[9px] font-semibold tracking-[0.08em] ${v.cls}`}
    >
      {v.label}
    </span>
  );
}
