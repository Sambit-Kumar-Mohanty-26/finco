import Link from "next/link";
import { notFound } from "next/navigation";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { DeltaChip, TierBadge, VerdictBadge } from "@/components/app/Badges";
import { RunTimeline } from "@/components/app/RunTimeline";
import { AgentPanel } from "@/components/app/AgentPanel";
import { apiGet, isErr, paiseOf, type Run } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await apiGet<Run>(`/v1/runs/${id}`);
  if (isErr(run)) {
    if (run.error.includes("404")) notFound();
    return (
      <main className="py-16">
        <Wrap>
          <p className="font-mono text-[13px] text-refused">{run.error}</p>
        </Wrap>
      </main>
    );
  }

  const total = Number(run.totalRows);
  const matched = Number(run.matchedRows);
  const pct = total === 0 ? 0 : (matched / total) * 100;
  const tiers = run.stages?.tiers ?? [];
  const settlements = run.stages?.settlements ?? [];
  const open = settlements.filter((s) => !s.closes);
  const unmatched = settlements.filter((s) => s.closes && s.bankProvenBy === null);

  return (
    <main className="py-14">
      <Wrap>
        <Link href="/runs" className="font-mono text-[11px] text-ink-hush hover:text-ink">
          ← Runs
        </Link>
        <h1 className="mt-4 font-display text-[clamp(26px,3vw,38px)] leading-[1.1] tracking-[-0.02em]">
          Run {run.id.slice(0, 8)}
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
          <Link href={`/runs/${run.id}/scorecard`} className="text-ink-hush hover:text-ink">
            Scorecard →
          </Link>
          <Link href={`/exceptions?runId=${run.id}`} className="text-ink-hush hover:text-ink">
            Exceptions{run.exceptions ? ` (${run.exceptions.open} open)` : ""} →
          </Link>
          <Link href={`/ledger?runId=${run.id}`} className="text-ink-hush hover:text-ink">
            Trial balance →
          </Link>
        </div>

        {/* live progress — and the same six rows once it has finished */}
        <div className="mt-8">
          <RunTimeline run={run} />
        </div>

        {/* headline counters */}
        <div className="mt-8 grid grid-cols-2 overflow-hidden rounded-[12px] border border-line-light bg-white md:grid-cols-4">
          <Stat label="matched" value={matched.toLocaleString("en-IN")} />
          <Stat label="residual" value={(total - matched).toLocaleString("en-IN")} border />
          <Stat label="auto-match" value={`${pct.toFixed(1)}%`} tone="signal" border />
          <Stat
            label="unproven"
            border
            node={<Money paise={paiseOf(run.unprovenPaise)} tone="refused" />}
          />
        </div>
        <p className="mt-3 max-w-[70ch] font-mono text-[11px] leading-relaxed text-ink-hush">
          A match rate is a percentage of rows. The unproven figure is a number in rupees, which is
          what has to reach zero before a period can close.
        </p>

        {/* tiers */}
        <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
          Tier by tier
        </h2>
        <div className="mt-4 overflow-hidden rounded-[12px] border border-line-light bg-white">
          {tiers.map((t, i) => (
            <div
              key={t.key}
              className={`flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 ${
                i > 0 ? "border-t border-line-light" : ""
              }`}
            >
              <TierBadge tier={t.key} />
              <span className="min-w-[220px] flex-1">
                <span className="block text-[14px] text-ink">{t.label}</span>
                <span className="block font-mono text-[11px] text-ink-hush">{t.detail}</span>
              </span>
              <span className="font-mono text-[12px] tnum text-ink">
                {t.matchedRows.toLocaleString("en-IN")} rows
              </span>
              <span className="font-mono text-[11px] text-ink-hush">{t.links} links</span>
              {t.escalated > 0 ? (
                <span className="font-mono text-[11px] text-refused">{t.escalated} refused</span>
              ) : null}
            </div>
          ))}
        </div>

        {/* per-settlement identity */}
        <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
          Identity per settlement · I1
        </h2>
        <p className="mt-2 max-w-[70ch] font-mono text-[11px] leading-relaxed text-ink-hush">
          settlement.amount = SUM(credit) − SUM(debit). Credit is already net of fee; subtracting it
          again is the bug that stops every settlement closing.
        </p>
        <div className="mt-4 overflow-x-auto rounded-[12px] border border-line-light bg-white">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                {["Settlement", "Rows", "Amount", "Delta", "Bank credit", "Note"].map((h, i) => (
                  <th
                    key={h}
                    className={`border-b border-line-light px-5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-hush uppercase ${
                      i === 2 || i === 3 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.ref}>
                  <td className="border-b border-line-light px-5 py-2.5 font-mono text-[12px]">
                    {s.ref}
                  </td>
                  <td className="border-b border-line-light px-5 py-2.5 font-mono text-[12px] tnum text-ink-hush">
                    {s.matchedRows}/{s.rows}
                  </td>
                  <td className="border-b border-line-light px-5 py-2.5 text-right">
                    <Money paise={paiseOf(s.amountPaise)} className="text-[12px]" />
                  </td>
                  <td className="border-b border-line-light px-5 py-2.5 text-right">
                    <DeltaChip deltaPaise={s.deltaPaise} />
                  </td>
                  <td className="border-b border-line-light px-5 py-2.5">
                    {s.bankProvenBy ? (
                      <span className="inline-flex items-center gap-2">
                        <TierBadge tier={s.bankProvenBy} />
                        <VerdictBadge verdict="PROVEN" />
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-refused">not proven</span>
                    )}
                  </td>
                  <td className="border-b border-line-light px-5 py-2.5 font-mono text-[11px] text-ink-hush">
                    {s.note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(open.length > 0 || unmatched.length > 0) && (
          <p className="mt-4 max-w-[74ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
            {open.length > 0 ? (
              <>
                <span className="text-refused">{open.length}</span> settlement
                {open.length === 1 ? "" : "s"} did not close against their own rows, so no bank
                credit was matched to them — the engine refuses rather than guessing.{" "}
              </>
            ) : null}
            {unmatched.length > 0 ? (
              <>
                <span className="text-refused">{unmatched.length}</span> closed but have no proven
                bank credit yet (held settlements, or a narration no tier could read).
              </>
            ) : null}
          </p>
        )}

        {/* the model tier, and the verifier's answer to it */}
        <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
          Tier 5 · what the model proposed
        </h2>
        <p className="mt-2 max-w-[70ch] font-mono text-[11px] leading-relaxed text-ink-hush">
          The model reads only what the five deterministic tiers could not explain, and it cannot
          post. Every claim below is shown beside the verifier&rsquo;s verdict on it.
        </p>
        <div className="mt-4">
          <AgentPanel judged={run.stages?.judged ?? []} agent={run.stages?.agent} />
        </div>

        {/* the links themselves */}
        {run.links && run.links.length > 0 ? (
          <>
            <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
              Match links
            </h2>
            <div className="mt-4 overflow-x-auto rounded-[12px] border border-line-light bg-white">
              <table className="w-full min-w-[720px] border-collapse">
                <tbody>
                  {run.links.map((l) => (
                    <tr key={l.id}>
                      <td className="border-b border-line-light px-5 py-2.5">
                        <TierBadge tier={l.tier} />
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5">
                        <VerdictBadge verdict={l.verdict} />
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5 font-mono text-[12px]">
                        {l.leftRef} → {l.rightRef}
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5 text-right">
                        <Money paise={paiseOf(l.amountPaise)} className="text-[12px]" />
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5 font-mono text-[11px] text-ink-hush">
                        {l.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Wrap>
    </main>
  );
}

function Stat({
  label,
  value,
  node,
  tone,
  border,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  tone?: "signal";
  border?: boolean;
}) {
  return (
    <div className={`px-6 py-5 ${border ? "border-l border-line-light" : ""}`}>
      <div
        className={`font-mono text-[22px] font-medium tnum tracking-[-0.01em] ${
          tone === "signal" ? "text-signal-deep" : "text-ink"
        }`}
      >
        {node ?? value}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] tracking-[0.12em] text-ink-hush uppercase">
        {label}
      </div>
    </div>
  );
}
