import Link from "next/link";
import { notFound } from "next/navigation";
import { paise } from "@finco/core";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { TierBadge, VerdictBadge } from "@/components/app/Badges";
import { NarrationHighlight } from "@/components/app/NarrationHighlight";
import { Resolver } from "@/components/app/Resolver";
import { apiGet, isErr, type Exception, type Run } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * One exception, and the decision about it.
 *
 * Evidence on the left, decision on the right, and never the other way round.
 * The layout is the argument: you cannot reach the controls without passing the
 * facts, and the facts include what the engine already tried and the exact
 * sentence it refused with. A queue that shows a code and an Approve button is
 * asking somebody to rubber-stamp a number they have not seen.
 */
export default async function ExceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ex = await apiGet<Exception>(`/v1/exceptions/${id}`);
  if (isErr(ex)) {
    if (ex.error.includes("404")) notFound();
    return (
      <main className="py-16">
        <Wrap>
          <p className="font-mono text-[13px] text-refused">{ex.error}</p>
        </Wrap>
      </main>
    );
  }

  // The run carries the settlement detail, which is where the candidates for a
  // manual link come from: everything that closed against its own rows but has
  // no proven bank credit yet. Anything else cannot legally be linked.
  const run = await apiGet<Run>(`/v1/runs/${ex.runId}`);
  const candidates = isErr(run)
    ? []
    : (run.stages?.settlements ?? [])
        .filter((s) => s.closes && s.bankProvenBy === null)
        .map((s) => ({ ref: s.ref, amountPaise: s.amountPaise, note: s.note || undefined }));

  const narration = String(ex.evidence.narration ?? "");
  const evidence = Object.entries(ex.evidence).filter(([k]) => k !== "narration");

  return (
    <main className="py-14">
      <Wrap>
        <Link
          href={`/exceptions?runId=${ex.runId}`}
          className="font-mono text-[11px] text-ink-hush hover:text-ink"
        >
          ← Queue
        </Link>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-[clamp(24px,2.8vw,34px)] leading-[1.1] tracking-[-0.02em]">
            {ex.spec?.label ?? ex.code}
          </h1>
          <span className="font-mono text-[11px] text-ink-hush">{ex.code}</span>
          <span
            className={`font-mono text-[10.5px] tracking-[0.08em] uppercase ${
              ex.spec?.severity === "blocking" ? "text-refused" : "text-ink-hush"
            }`}
          >
            {ex.spec?.severity ?? "review"} · {ex.spec?.owner ?? "Ops"} · SLA{" "}
            {ex.spec?.slaHours ?? 48}h
          </span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* ---- evidence -------------------------------------------------- */}
          <section aria-label="Evidence" className="space-y-4">
            <div className="rounded-[12px] border border-line-light bg-white p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-mono text-[13px]">{ex.subjectRef}</span>
                <Money paise={paise(ex.amountPaise)} className="text-[15px]" />
              </div>
              <p className="mt-3 max-w-[64ch] font-mono text-[11.5px] leading-relaxed text-ink">
                {ex.reason}
              </p>
              <p className="mt-3 font-mono text-[10.5px] text-ink-hush">
                {ex.subjectType} · as of {ex.asOf ?? "—"} · parked in {ex.parksTo} ·{" "}
                {ex.autoResolvable ? "auto-resolvable" : "needs a decision per item"}
              </p>
            </div>

            {narration ? (
              <div className="rounded-[12px] border border-line-light bg-white p-6">
                <p className="font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
                  bank narration
                </p>
                <p className="mt-2">
                  <NarrationHighlight text={narration} match={String(ex.evidence.utr ?? "")} />
                </p>
                <p className="mt-3 max-w-[60ch] font-mono text-[10.5px] leading-relaxed text-ink-hush">
                  Shown verbatim. This is the only free text in the pipeline and it comes from
                  outside, so it is rendered as data — marked, never interpreted.
                </p>
              </div>
            ) : null}

            {evidence.length > 0 ? (
              <div className="overflow-hidden rounded-[12px] border border-line-light bg-white">
                <p className="border-b border-line-light px-6 py-3 font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
                  what the engine recorded
                </p>
                <dl className="divide-y divide-line-light">
                  {evidence.map(([k, v]) => (
                    <div key={k} className="flex gap-4 px-6 py-2.5">
                      <dt className="w-[150px] shrink-0 font-mono text-[10.5px] text-ink-hush">{k}</dt>
                      <dd className="min-w-0 flex-1 font-mono text-[11.5px] break-all">
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {ex.related && ex.related.length > 0 ? (
              <div className="overflow-hidden rounded-[12px] border border-line-light bg-white">
                <p className="border-b border-line-light px-6 py-3 font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
                  what the engine already tried
                </p>
                <ul className="divide-y divide-line-light">
                  {ex.related.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-6 py-2.5">
                      <TierBadge tier={l.tier} />
                      <VerdictBadge verdict={l.verdict} />
                      <span className="font-mono text-[11.5px]">
                        {l.leftRef} → {l.rightRef}
                      </span>
                      <span className="max-w-[46ch] font-mono text-[10.5px] text-ink-hush">
                        {l.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {ex.spec?.playbook.length ? (
              <div className="rounded-[12px] border border-line-light bg-white p-6">
                <p className="font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
                  playbook
                </p>
                <ol className="mt-2 list-inside list-decimal space-y-1">
                  {ex.spec.playbook.map((p) => (
                    <li key={p} className="font-mono text-[11.5px] leading-relaxed text-ink">
                      {p}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          {/* ---- decision ---------------------------------------------------- */}
          <section aria-label="Decision" className="lg:sticky lg:top-6 lg:self-start">
            <Resolver exception={ex} candidates={candidates} />
          </section>
        </div>
      </Wrap>
    </main>
  );
}
