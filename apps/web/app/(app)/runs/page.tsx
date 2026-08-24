import Link from "next/link";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { apiGet, isErr, paiseOf, type Run } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const res = await apiGet<{ runs: Run[] }>("/v1/runs");

  return (
    <main className="py-16">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P2 · deterministic recon
        </span>
        <h1 className="mt-5 font-display text-[clamp(30px,4vw,46px)] leading-[1.06] tracking-[-0.02em]">
          Every match carries its proof.
        </h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-ink-hush">
          T0 joins on exact keys, T1 proves the settlement identity, T2 matches amount inside the
          T+2 banking window — and refuses when more than one answer fits.
        </p>

        {isErr(res) ? (
          <p className="mt-12 font-mono text-[13px] text-refused">{res.error}</p>
        ) : res.runs.length === 0 ? (
          <div className="mt-12 rounded-[12px] border border-dashed border-line-light px-8 py-14 text-center">
            <p className="text-[16px] text-ink">No runs yet.</p>
            <p className="mt-2 font-mono text-[12px] text-ink-hush">
              Open a dataset and press Close run.
            </p>
            <Link
              href="/datasets"
              className="mt-6 inline-block border border-ink px-4 py-2 font-mono text-[11px] hover:bg-ink hover:text-on-ink"
            >
              Datasets
            </Link>
          </div>
        ) : (
          <div className="mt-12 overflow-hidden rounded-[12px] border border-line-light bg-white">
            {res.runs.map((r, i) => {
              const total = Number(r.totalRows);
              const matched = Number(r.matchedRows);
              const pct = total === 0 ? 0 : (matched / total) * 100;
              return (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className={`flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4 transition-colors hover:bg-paper ${
                    i > 0 ? "border-t border-line-light" : ""
                  }`}
                >
                  <span className="min-w-[150px] font-mono text-[12px] text-ink">
                    {r.id.slice(0, 8)}
                  </span>
                  <span className="font-mono text-[11px] tracking-[0.08em] text-signal-deep uppercase">
                    {r.state}
                  </span>
                  <span className="font-mono text-[12px] tnum text-ink-hush">
                    <span className="text-ink">{matched.toLocaleString("en-IN")}</span> /{" "}
                    {total.toLocaleString("en-IN")} rows
                  </span>
                  <span className="font-mono text-[12px] tnum text-ink">{pct.toFixed(1)}%</span>
                  <span className="ml-auto font-mono text-[12px] text-ink-hush">
                    unproven <Money paise={paiseOf(r.unprovenPaise)} className="text-refused" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Wrap>
    </main>
  );
}
