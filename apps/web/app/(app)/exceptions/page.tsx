import Link from "next/link";
import { paise } from "@finco/core";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { ExceptionQueue } from "@/components/app/ExceptionQueue";
import { apiGet, isErr, type ExceptionPage, type Run } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The exception queue.
 *
 * Filter state lives in searchParams and nowhere else, which is the whole
 * reason the facets are plain links rather than buttons over client state:
 * "the six E08s over ₹50,000, still open" is then a URL somebody can paste into
 * a message to the person who owns them. State held in a component is state
 * that cannot be shared, bookmarked, or reloaded into.
 */

const STATUSES = ["OPEN", "RESOLVED", "ALL"] as const;

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  // No run in the URL: take the newest, so the page is useful from the nav.
  let runId = one("runId");
  if (!runId) {
    const list = await apiGet<{ runs: Run[] }>("/v1/runs");
    if (!isErr(list)) runId = list.runs[0]?.id ?? "";
  }

  const status = one("status") || "OPEN";
  const codes = one("code").split(",").filter(Boolean);

  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ runId, status, ...(codes.length ? { code: codes.join(",") } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    return `/exceptions?${q}`;
  };
  /** Clicking a facet toggles it, so several classes can be reviewed together. */
  const toggled = (code: string) =>
    href({ code: (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]).join(",") });

  const cursor = one("cursor");
  const page = runId
    ? await apiGet<ExceptionPage>(
        `/v1/exceptions?runId=${runId}&status=${status}` +
          (codes.length ? `&code=${codes.join(",")}` : "") +
          (cursor ? `&cursor=${cursor}` : ""),
      )
    : { error: "no run yet — close one first" };

  return (
    <main className="py-14">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P4 · exception queue
        </span>
        <h1 className="mt-5 font-display text-[clamp(28px,3.4vw,42px)] leading-[1.06] tracking-[-0.02em]">
          Fourteen classes, each with an owner.
        </h1>
        <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink-hush">
          &ldquo;Unmatched: 312 rows&rdquo; is an abdication, not an exception list. A typed
          exception carries an owner, a playbook, an account it parks in, and an amount — which is
          what turns a backlog into a morning&rsquo;s work.
        </p>

        {isErr(page) ? (
          <p className="mt-12 font-mono text-[13px] text-refused">{page.error}</p>
        ) : (
          <>
            {/* status + facets, both in the URL */}
            <div className="mt-10 flex flex-wrap items-center gap-2">
              {STATUSES.map((s) => (
                <Link
                  key={s}
                  href={href({ status: s })}
                  className={`border px-3 py-1.5 font-mono text-[10.5px] tracking-[0.08em] uppercase ${
                    s === status ? "border-ink bg-ink text-on-ink" : "border-line-light hover:bg-white"
                  }`}
                >
                  {s}
                  {page.statuses.find((x) => x.status === s) ? (
                    <span className="ml-2 opacity-60">
                      {page.statuses.find((x) => x.status === s)!.n}
                    </span>
                  ) : s === "ALL" ? (
                    <span className="ml-2 opacity-60">
                      {page.statuses.reduce((a, x) => a + x.n, 0)}
                    </span>
                  ) : null}
                </Link>
              ))}
              {codes.length > 0 ? (
                <Link
                  href={href({ code: "" })}
                  className="ml-2 font-mono text-[10.5px] text-ink-hush underline hover:text-ink"
                >
                  clear {codes.length} filter{codes.length === 1 ? "" : "s"}
                </Link>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {page.facets.map((f) => {
                const on = codes.includes(f.code);
                return (
                  <Link
                    key={f.code}
                    href={toggled(f.code)}
                    aria-pressed={on}
                    className={`flex items-baseline gap-3 rounded-[8px] border px-4 py-2.5 ${
                      on ? "border-ink bg-white" : "border-line-light hover:bg-white"
                    }`}
                  >
                    <span className="font-mono text-[11px] tnum text-ink">{f.n}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{f.label}</span>
                      <span className="block font-mono text-[10px] text-ink-hush">
                        {f.code} · {f.owner}
                      </span>
                    </span>
                    <Money paise={paise(f.valuePaise)} className="text-[11px] text-ink-hush" />
                  </Link>
                );
              })}
            </div>
            <p className="mt-2 font-mono text-[10.5px] text-ink-hush">
              Counts are for the whole run, not the filtered page — a facet that only counts what is
              already on screen tells you nothing you cannot see.
            </p>

            <div className="mt-8">
              <ExceptionQueue rows={page.exceptions} />
            </div>

            {page.nextCursor ? (
              <Link
                href={`${href({})}&cursor=${page.nextCursor}`}
                className="mt-4 inline-block border border-line-light px-4 py-2 font-mono text-[11px] hover:bg-white"
              >
                Next page →
              </Link>
            ) : null}
          </>
        )}
      </Wrap>
    </main>
  );
}
