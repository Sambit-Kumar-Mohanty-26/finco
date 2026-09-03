import Link from "next/link";
import { Money } from "@/components/money/Money";
import { paiseOf, type AgeingBucket } from "@/lib/api";

/**
 * Where the money that has not arrived is sitting.
 *
 * The overdue rows link into the exception queue, already filtered to open
 * items. That link is the point of the page: an ageing bucket that only tells
 * you a number is a fact, and the same bucket with somewhere to click is a
 * morning's work. Anything past its own settlement window is no longer a
 * question of "when" — it is a question of "who".
 */
export function AgeingBuckets({ buckets, runId }: { buckets: AgeingBucket[]; runId?: string | null }) {
  const queue = `/exceptions?status=OPEN${runId ? `&runId=${runId}` : ""}`;

  return (
    <div className="overflow-x-auto rounded-[12px] border border-line-light bg-white">
      <table className="w-full min-w-[420px] border-collapse text-[13.5px]">
        <caption className="sr-only">
          Captured money not yet settled, by age. Overdue rows link to the open exception queue.
        </caption>
        <thead>
          <tr>
            {["Age", "Items", "Value"].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`border-b border-line-light px-4 py-2.5 font-mono text-[9.5px] font-semibold tracking-[0.12em] text-ink-hush uppercase ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key} className={b.overdue ? "bg-refused/[0.06]" : undefined}>
              <th scope="row" className="border-b border-line-light px-4 py-3 text-left font-medium">
                {b.overdue ? (
                  <Link href={queue} className="text-refused underline decoration-refused/40 underline-offset-2">
                    {b.label}
                  </Link>
                ) : (
                  b.label
                )}
                <span className="mt-0.5 block font-mono text-[10px] font-normal text-ink-hush">
                  {b.toDays === null ? `${b.fromDays}+ banking days` : `${b.fromDays}–${b.toDays} banking days`}
                  {b.overdue ? " · past its window" : ""}
                </span>
              </th>
              <td className="border-b border-line-light px-4 py-3 text-right font-mono text-[12px] tnum text-ink-hush">
                {b.items}
              </td>
              <td className="border-b border-line-light px-4 py-3 text-right">
                <Money paise={paiseOf(b.valuePaise)} tone={b.overdue ? "refused" : "inherit"} className="text-[12.5px]" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
