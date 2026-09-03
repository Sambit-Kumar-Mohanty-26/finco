import Link from "next/link";
import { Wrap } from "@/components/layout/Wrap";
import { LockButton } from "@/components/app/LockButton";
import { apiGet, isErr, type PeriodDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

type PeriodRow = { period: string; state: string; lockedAt: string | null; lockedBy: string | null };

/**
 * The close checklist, and the lock.
 *
 * Every item is COMPUTED. Nothing here can be ticked by hand, because a
 * checklist a person can tick without the underlying thing being true is a
 * formality — and formalities are what get signed off at 7pm on the last day of
 * the month. The only manual step is the lock, which is a decision rather than
 * a fact.
 */
export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  const list = await apiGet<{ periods: PeriodRow[] }>("/v1/periods");
  const periods = isErr(list) ? [] : list.periods;
  const period = one("period") || periods[0]?.period || "";
  const detail = period ? await apiGet<PeriodDetail>(`/v1/periods/${period}`) : null;

  return (
    <main className="py-8 sm:py-12">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P8 · close
        </span>
        <h1 className="mt-4 font-display text-[clamp(26px,3.2vw,38px)] leading-[1.06] tracking-[-0.02em]">
          Nothing here is ticked by hand.
        </h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-ink-hush">
          Each item is measured when this page loads, and the lock refuses while any of them fails.
        </p>

        {isErr(list) ? (
          <p className="mt-10 font-mono text-[13px] text-refused">{list.error}</p>
        ) : periods.length === 0 ? (
          <p className="mt-10 font-mono text-[13px] text-ink-hush">
            No periods yet.{" "}
            <Link href="/datasets" className="underline">
              Seed a dataset
            </Link>{" "}
            and close a run first.
          </p>
        ) : (
          <>
            <nav className="mt-6 flex flex-wrap gap-2">
              {periods.map((p) => (
                <Link
                  key={p.period}
                  href={`/periods?period=${p.period}`}
                  aria-current={p.period === period ? "page" : undefined}
                  className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] ${
                    p.period === period
                      ? "border-signal-deep bg-signal-wash text-ink"
                      : "border-line-light bg-white text-ink-hush hover:text-ink"
                  }`}
                >
                  {p.period}
                  {p.state === "LOCKED" ? " · locked" : ""}
                </Link>
              ))}
            </nav>

            {detail && !isErr(detail) ? (
              <>
                <div className="mt-8 flex flex-wrap items-start justify-between gap-4 rounded-[12px] border border-line-light bg-white px-5 py-4">
                  <div>
                    <p className="font-mono text-[11px] tracking-[0.1em] text-ink-hush uppercase">
                      {detail.state}
                    </p>
                    <p className="mt-1 text-[15px]">
                      {detail.state === "LOCKED"
                        ? `Locked by ${detail.lockedBy} on ${detail.lockedAt?.slice(0, 10)}.`
                        : detail.ready
                          ? "Every check passes. This period is ready to lock."
                          : `${detail.items.filter((i) => !i.pass).length} of ${detail.items.length} checks fail.`}
                    </p>
                  </div>
                  <LockButton
                    period={detail.period}
                    locked={detail.state === "LOCKED"}
                    ready={detail.ready}
                  />
                </div>

                <ol className="mt-6 space-y-2">
                  {detail.items.map((i) => (
                    <li
                      key={i.key}
                      className={`rounded-[10px] border px-5 py-3.5 ${
                        i.pass ? "border-line-light bg-white" : "border-refused/40 bg-refused/[0.06]"
                      }`}
                    >
                      <div className="flex items-baseline gap-3">
                        <span
                          aria-hidden="true"
                          className={`font-mono text-[13px] ${i.pass ? "text-signal-deep" : "text-refused"}`}
                        >
                          {i.pass ? "✓" : "✗"}
                        </span>
                        <span className="text-[14.5px] font-medium">
                          {i.label}
                          <span className="sr-only">{i.pass ? " — passes" : " — fails"}</span>
                        </span>
                        <span
                          className={`ml-auto shrink-0 font-mono text-[11px] ${i.pass ? "text-ink-hush" : "text-refused"}`}
                        >
                          {i.detail}
                        </span>
                      </div>
                      <p className="mt-1 pl-6 text-[12.5px] leading-[1.45] text-ink-hush">{i.why}</p>
                    </li>
                  ))}
                </ol>

                {detail.runId ? (
                  <p className="mt-6 font-mono text-[11px] text-ink-hush">
                    measured against{" "}
                    <Link href={`/runs/${detail.runId}`} className="underline">
                      run {detail.runId.slice(0, 8)}
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-10 font-mono text-[13px] text-refused">
                {detail && isErr(detail) ? detail.error : "no period selected"}
              </p>
            )}
          </>
        )}
      </Wrap>
    </main>
  );
}
