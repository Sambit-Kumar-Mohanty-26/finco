import Link from "next/link";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { CashCurve } from "@/components/app/CashCurve";
import { AgeingBuckets } from "@/components/app/AgeingBuckets";
import { apiGet, isErr, paiseOf, type CashForecast, type Run } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The cash page, written for a phone.
 *
 * It answers exactly two questions, and both are above the fold: how much lands
 * in the next fortnight, and what is stuck. Everything below — the curve, the
 * ageing table, the fitted refund rate — is the working behind those two
 * answers, for whoever wants to check them.
 *
 * Mobile-first is not a layout preference here. This is the screen somebody
 * opens in a taxi before a payment decision, so it stacks by default and only
 * goes two-up when there is room. No horizontal scroll at 360 px.
 */
export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const datasetId = one("datasetId");

  const [data, runList] = await Promise.all([
    apiGet<CashForecast>(`/v1/cash/forecast${datasetId ? `?datasetId=${datasetId}` : ""}`),
    apiGet<{ runs: Run[] }>("/v1/runs"),
  ]);

  if (isErr(data)) {
    return (
      <main className="py-12">
        <Wrap>
          <h1 className="font-display text-[clamp(26px,3.2vw,38px)] leading-[1.06] tracking-[-0.02em]">
            No cash forecast yet.
          </h1>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-hush">{data.error}</p>
          <Link href="/datasets" className="mt-6 inline-block font-mono text-[12px] text-signal-deep underline">
            Seed or upload a dataset →
          </Link>
        </Wrap>
      </main>
    );
  }

  const runId = isErr(runList) ? null : (runList.runs.find((r) => r.datasetId === data.datasetId)?.id ?? null);
  const last = data.curve.at(-1);
  const overdue = data.buckets.filter((b) => b.overdue);
  const overdueItems = overdue.reduce((a, b) => a + b.items, 0);
  const { floor } = data;

  /**
   * The floor verdict, in a sentence, above the chart.
   *
   * A line crossing another line is a picture, and a picture is something a
   * reader has to interpret under time pressure. The words are the warning; the
   * chart is the evidence for them.
   */
  const verdict = floor.breach
    ? `On the cautious line you are ${
        floor.clearsOn ? `short until ${floor.clearsOn}` : `short for the whole fortnight`
      }.`
    : `The cautious line clears the floor${floor.clearsOn ? ` from ${floor.clearsOn}` : ""}.`;

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <main className="py-8 sm:py-12">
      <Wrap>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
            P7 · cash
          </span>
          {/* Cached is fine. Cached and UNLABELLED is how a stale figure ends
              up in a board pack, so the age is on the page either way. */}
          <span className="font-mono text-[10.5px] text-ink-hush">
            as of {data.asOf}
            {data.cachedAgeMs > 0
              ? ` · cached ${Math.round(data.cachedAgeMs / 60000)} min ago${data.stale ? ", refreshing" : ""}`
              : " · fresh"}
          </span>
        </div>

        {/* --- both answers, above the fold --------------------------------- */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <section className="rounded-[12px] border border-line-light bg-white px-5 py-4">
            <h1 className="text-[14px] font-medium">Landing in {data.days} days</h1>
            <p className="mt-2">
              <Money
                paise={paiseOf(last?.cumP10Paise ?? "0")}
                tone={floor.breach ? "refused" : "inherit"}
                className="text-[clamp(26px,7vw,34px)] leading-none"
              />
            </p>
            <p className="mt-2 text-[13.5px] leading-[1.45] text-ink-hush">
              at p10 — the cautious line.{" "}
              <Money paise={paiseOf(last?.cumP50Paise ?? "0")} className="text-[12px]" /> is the middle
              estimate.
            </p>
            <p className={`mt-2 text-[13.5px] leading-[1.45] ${floor.breach ? "text-refused" : ""}`}>
              {verdict}
              {floor.breach ? (
                <>
                  {" "}
                  Short by <Money paise={paiseOf(floor.shortfallPaise)} tone="refused" className="text-[12.5px]" />{" "}
                  against a floor of <Money paise={paiseOf(floor.floorPaise)} className="text-[12.5px]" />.
                </>
              ) : null}
            </p>
          </section>

          <section className="rounded-[12px] border border-line-light bg-white px-5 py-4">
            <h2 className="text-[14px] font-medium">Stuck past its window</h2>
            <p className="mt-2">
              <Money
                paise={paiseOf(data.unprovenPaise)}
                tone={overdueItems > 0 ? "refused" : "inherit"}
                className="text-[clamp(26px,7vw,34px)] leading-none"
              />
            </p>
            <p className="mt-2 text-[13.5px] leading-[1.45] text-ink-hush">
              {overdueItems === 0
                ? "Nothing is overdue. Every capture is still inside its own settlement window."
                : `${overdueItems} captures are past T+2 (T+7 international) and are not in the curve above.`}
            </p>
            {overdueItems > 0 ? (
              <Link
                href={`/exceptions?status=OPEN${runId ? `&runId=${runId}` : ""}`}
                className="mt-2 inline-block font-mono text-[12px] text-signal-deep underline underline-offset-2"
              >
                Open the queue →
              </Link>
            ) : null}
          </section>
        </div>

        {/* --- the working ------------------------------------------------- */}
        <h2 className="mt-10 text-[15px] font-medium">{verdict}</h2>
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-hush">
          Cumulative, from {data.asOf}. The band is p10 to p90; the heavy line is p10, because a cash
          forecast is read for the downside.
        </p>
        <div className="mt-4">
          <CashCurve curve={data.curve} floorPaise={floor.floorPaise} breachDate={floor.clearsOn} />
        </div>

        <h2 className="mt-10 text-[15px] font-medium">What has not arrived</h2>
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-hush">
          Captured money by age, in banking days. Overdue rows go to the exception queue.
        </p>
        <div className="mt-4">
          <AgeingBuckets buckets={data.buckets} runId={runId} />
        </div>

        {/* The fit is published rather than hidden: a forecast whose
            assumptions cannot be argued with does not get trusted with a
            payment decision. */}
        <h2 className="mt-10 text-[15px] font-medium">How the refund rate was fitted</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Domestic · T+2", data.propensity.domestic],
              ["International · T+7", data.propensity.international],
            ] as const
          ).map(([label, p]) => (
            <div key={label} className="rounded-[12px] border border-line-light bg-white px-5 py-4">
              <dt className="font-mono text-[10px] tracking-[0.1em] text-ink-hush uppercase">{label}</dt>
              <dd className="mt-1.5 font-mono text-[15px] tnum">
                {pct(p.rate)}{" "}
                <span className="text-[11.5px] text-ink-hush">
                  ({pct(p.low)}–{pct(p.high)})
                </span>
              </dd>
              <dd className="mt-1 text-[12.5px] leading-[1.45] text-ink-hush">
                {p.n < 20
                  ? `Only ${p.n} captures — too few to fit, so a 3% prior is used and the band is deliberately wide.`
                  : `Value-weighted over ${p.n} captures. Counting refunds rather than weighting them by value would read roughly double.`}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-8 font-mono text-[11px] text-ink-hush">
          {data.datasetName} · {data.period} ·{" "}
          <Link href={`/datasets/${data.datasetId}`} className="underline">
            dataset
          </Link>
        </p>
      </Wrap>
    </main>
  );
}
