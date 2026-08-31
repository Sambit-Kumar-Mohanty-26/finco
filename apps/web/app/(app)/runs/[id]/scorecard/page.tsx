import Link from "next/link";
import { notFound } from "next/navigation";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { apiGet, isErr, paiseOf, type ScalePoint, type Scorecard } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The scorecard.
 *
 * "It matched 94%" is a claim. A measurement needs a truth file the engine has
 * never seen, and on a real customer's data no such file exists — so precision
 * there is NOT MEASURABLE and this page says exactly that rather than printing
 * 1.000, which would be the most dishonest number the system could show.
 *
 * The scorecard is produced by REPLAYING the run from its stored inputs. If the
 * replay disagrees with what was committed, the engine has stopped being
 * deterministic and every figure here describes a different run from the one in
 * the ledger — so that disagreement is the loudest thing on the page.
 */
export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [card, scale] = await Promise.all([
    apiGet<Scorecard>(`/v1/runs/${id}/scorecard`),
    apiGet<{ curve: ScalePoint[] }>("/v1/eval/scale"),
  ]);

  if (isErr(card)) {
    if (card.error.includes("404")) notFound();
    return (
      <main className="py-16">
        <Wrap>
          <p className="font-mono text-[13px] text-refused">{card.error}</p>
        </Wrap>
      </main>
    );
  }

  const passed = card.failures.length === 0;

  return (
    <main className="py-14">
      <Wrap>
        <Link href={`/runs/${id}`} className="font-mono text-[11px] text-ink-hush hover:text-ink">
          ← Run {id.slice(0, 8)}
        </Link>
        <h1 className="mt-4 font-display text-[clamp(26px,3vw,38px)] leading-[1.1] tracking-[-0.02em]">
          Scorecard
        </h1>
        <p className="mt-3 max-w-[70ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
          Run hash <span className="text-ink">{card.runHash}</span> over canonicalised inputs. Two
          runs with the same hash must produce the same numbers; the hash is invariant to row order
          and changes on one paise.
        </p>

        {/* gate verdict */}
        <div
          className={`mt-8 rounded-[12px] border px-6 py-5 ${
            passed ? "border-signal-deep/40 bg-signal-wash" : "border-refused/40 bg-white"
          }`}
        >
          <p
            className={`font-mono text-[11px] tracking-[0.12em] uppercase ${
              passed ? "text-signal-deep" : "text-refused"
            }`}
          >
            {passed ? "gate passes" : `gate fails · ${card.failures.length}`}
          </p>
          {passed ? (
            <p className="mt-2 max-w-[70ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
              Every threshold met, including precision at exactly 1.000. A recall of 0.92 means eight
              settlements need a person, which is a Tuesday; a precision of 0.99 means one posting in
              a hundred is a lie in the general ledger, which is a restatement.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {card.failures.map((f) => (
                <li key={f.metric} className="max-w-[76ch] font-mono text-[11.5px] text-ink">
                  <span className="text-refused">{f.metric}</span> {String(f.got)} &lt; {f.want} —{" "}
                  <span className="text-ink-hush">{f.note}</span>
                </li>
              ))}
            </ul>
          )}
          {!card.replayMatchesRun ? (
            <p className="mt-3 max-w-[76ch] font-mono text-[11.5px] text-refused">
              The replay does not match the committed run. These numbers describe a different run
              from the one in the ledger — treat the engine as non-deterministic until this is
              explained.
            </p>
          ) : null}
        </div>

        {/* the metrics */}
        <div className="mt-8 grid gap-px overflow-hidden rounded-[12px] border border-line-light bg-line-light sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="auto-match" value={`${card.autoMatchPct}%`} want={card.thresholds.autoMatchPct} got={card.autoMatchPct} />
          <Metric
            label="precision"
            value={card.measurable ? card.precision!.toFixed(3) : "not measurable"}
            want={card.thresholds.precision}
            got={card.precision}
            measurable={card.measurable}
          />
          <Metric
            label="recall"
            value={card.measurable ? card.recall!.toFixed(3) : "not measurable"}
            want={card.thresholds.recall}
            got={card.recall}
            measurable={card.measurable}
          />
          <Metric label="false matches" value={String(card.falseMatches.length)} want={0} got={card.falseMatches.length === 0 ? 1 : 0} />
          <Metric label="value coverage" value={`${card.valueCoveragePct}%`} want={card.thresholds.valueCoveragePct} got={card.valueCoveragePct} />
          <Metric
            label="exception F1"
            value={card.measurable ? card.exceptionF1!.toFixed(3) : "not measurable"}
            want={card.thresholds.exceptionF1}
            got={card.exceptionF1}
            measurable={card.measurable}
          />
          <Metric label="identity closure" value={`${card.identityClosurePct}%`} want={100} got={card.identityClosurePct} />
          <Metric label="unproven" node={<Money paise={paiseOf(card.unprovenPaise)} tone="refused" className="text-[20px]" />} />
        </div>
        <p className="mt-3 max-w-[76ch] font-mono text-[11px] leading-relaxed text-ink-hush">
          {card.note}
        </p>

        {!card.measurable ? (
          <div className="mt-6 rounded-[12px] border border-dashed border-line-light bg-white px-6 py-5">
            <p className="font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
              why three numbers are blank
            </p>
            <p className="mt-2 max-w-[76ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
              Precision, recall and exception F1 each need a truth file — a list of the
              correspondences that are genuinely there — and this dataset was uploaded rather than
              generated, so no such list exists. The metrics that need no truth are still shown and
              the gate still enforces what it honestly can.
            </p>
          </div>
        ) : null}

        {/* false matches, named */}
        {card.falseMatches.length > 0 ? (
          <>
            <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-refused uppercase">
              Postings not in the truth file
            </h2>
            <div className="mt-4 overflow-hidden rounded-[12px] border border-refused/40 bg-white">
              {card.falseMatches.map((f) => (
                <div key={f.bankRef} className="border-b border-line-light px-5 py-3 last:border-b-0">
                  <span className="font-mono text-[12px]">
                    {f.bankRef} → {f.settlementRefs.join(" + ")}
                  </span>
                  <span className="ml-3 font-mono text-[10.5px] text-ink-hush">
                    {f.tier} · {f.reason}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* per-code classification */}
        {card.exceptionDetail.length > 0 ? (
          <>
            <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
              Exception classification, per class
            </h2>
            <p className="mt-2 max-w-[70ch] font-mono text-[11px] leading-relaxed text-ink-hush">
              Macro F1, so a class with three instances counts as much as one with three hundred.
              Micro F1 would let the common codes hide a class the engine never once got right.
            </p>
            <div className="mt-4 overflow-x-auto rounded-[12px] border border-line-light bg-white">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr>
                    {["Code", "TP", "FP", "FN", "F1"].map((h, i) => (
                      <th
                        key={h}
                        className={`border-b border-line-light px-5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-hush uppercase ${
                          i === 0 ? "text-left" : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {card.exceptionDetail.map((d) => (
                    <tr key={d.code}>
                      <td className="border-b border-line-light px-5 py-2 font-mono text-[11.5px]">{d.code}</td>
                      <td className="border-b border-line-light px-5 py-2 text-right font-mono text-[11.5px] tnum">{d.tp}</td>
                      <td className="border-b border-line-light px-5 py-2 text-right font-mono text-[11.5px] tnum text-refused">{d.fp || ""}</td>
                      <td className="border-b border-line-light px-5 py-2 text-right font-mono text-[11.5px] tnum text-refused">{d.fn || ""}</td>
                      <td
                        className={`border-b border-line-light px-5 py-2 text-right font-mono text-[11.5px] tnum ${
                          d.f1 >= 0.9 ? "text-signal-deep" : "text-refused"
                        }`}
                      >
                        {d.f1.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {/* the scale curve */}
        <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
          Scale curve
        </h2>
        <p className="mt-2 max-w-[70ch] font-mono text-[11px] leading-relaxed text-ink-hush">
          Quality must not decay with volume. A matcher that only works on a small file is a demo,
          and the 50,000-row point is the one that finds the O(n²).
        </p>
        {isErr(scale) ? (
          <p className="mt-4 font-mono text-[12px] text-refused">{scale.error}</p>
        ) : (
          <ScaleCurve curve={scale.curve} />
        )}
      </Wrap>
    </main>
  );
}

function Metric({
  label,
  value,
  node,
  want,
  got,
  measurable = true,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  want?: number;
  got?: number | null;
  measurable?: boolean;
}) {
  const ok = want === undefined || got === null || got === undefined ? null : got >= want;
  return (
    <div className="bg-white px-6 py-5">
      <div
        className={`font-mono text-[20px] font-medium tnum tracking-[-0.01em] ${
          !measurable ? "text-[13px] text-ink-hush italic" : ok === false ? "text-refused" : "text-ink"
        }`}
      >
        {node ?? value}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] tracking-[0.12em] text-ink-hush uppercase">
        {label}
        {want !== undefined && measurable ? <span className="ml-2 normal-case">≥ {want}</span> : null}
      </div>
    </div>
  );
}

/**
 * The curve as bars, not a plotted line.
 *
 * Four points do not make a line worth drawing with a charting library, and a
 * bar per size reads the value directly — the question here is "is precision
 * still 1.000 at fifty thousand rows", which is a lookup, not a trend.
 */
function ScaleCurve({ curve }: { curve: ScalePoint[] }) {
  const slowest = Math.max(1, ...curve.map((p) => p.ms));
  return (
    <div className="mt-4 overflow-hidden rounded-[12px] border border-line-light bg-white">
      {curve.map((p) => (
        <div
          key={p.rows}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line-light px-5 py-3 last:border-b-0"
        >
          <span className="w-[90px] shrink-0 font-mono text-[12px] tnum">
            {p.rows.toLocaleString("en-IN")}
          </span>
          <span className="flex min-w-[120px] flex-1 items-center gap-3">
            <span
              aria-hidden="true"
              className="block h-[6px] rounded-full bg-signal-deep/70"
              style={{ width: `${Math.max(3, (p.ms / slowest) * 100)}%` }}
            />
            <span className="font-mono text-[10.5px] text-ink-hush">{p.ms}ms</span>
          </span>
          <span className="font-mono text-[11px] tnum text-ink-hush">
            match {p.autoMatchPct.toFixed(1)}%
          </span>
          <span
            className={`font-mono text-[11px] tnum ${
              p.precision === 1 ? "text-signal-deep" : "text-refused"
            }`}
          >
            p {p.precision === null ? "—" : p.precision.toFixed(3)}
          </span>
          <span className="font-mono text-[11px] tnum text-ink-hush">
            f1 {p.exceptionF1 === null ? "—" : p.exceptionF1.toFixed(3)}
          </span>
          <span
            className={`w-[52px] text-right font-mono text-[10px] tracking-[0.08em] uppercase ${
              p.passes ? "text-signal-deep" : "text-refused"
            }`}
          >
            {p.passes ? "pass" : "fail"}
          </span>
        </div>
      ))}
    </div>
  );
}
