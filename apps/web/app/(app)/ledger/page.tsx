import Link from "next/link";
import { paise } from "@finco/core";
import { Wrap } from "@/components/layout/Wrap";
import { Money } from "@/components/money/Money";
import { apiGet, isErr, type JournalEntry, type Run, type TrialBalance } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The trial balance.
 *
 * Suspense is broken out above the table rather than sitting at 9999 in
 * account order, because a trial balance that ties while 9999 holds lakhs is
 * arithmetic, not a result. Debits equalling credits only proves the software
 * can add; the number that says whether the close WORKED is how little is
 * parked in suspense, and that number is given the largest type on the page.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  let runId = one("runId");
  if (!runId) {
    const list = await apiGet<{ runs: Run[] }>("/v1/runs");
    if (!isErr(list)) runId = list.runs[0]?.id ?? "";
  }
  const account = one("account");

  const q = runId ? `?runId=${runId}` : "";
  const [tb, journal] = await Promise.all([
    apiGet<TrialBalance>(`/v1/ledger/trial-balance${q}`),
    apiGet<{ entries: JournalEntry[]; nextCursor: string | null }>(
      `/v1/ledger/entries${q}${account ? `${q ? "&" : "?"}account=${account}` : ""}`,
    ),
  ]);

  return (
    <main className="py-14">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P4 · ledger
        </span>
        <h1 className="mt-5 font-display text-[clamp(28px,3.4vw,42px)] leading-[1.06] tracking-[-0.02em]">
          The output is a balanced journal.
        </h1>
        <p className="mt-3 max-w-[66ch] text-[15px] leading-relaxed text-ink-hush">
          A CSV of matches cannot fail. A ledger can, loudly, and that is the point.
        </p>

        {isErr(tb) ? (
          <p className="mt-12 font-mono text-[13px] text-refused">{tb.error}</p>
        ) : (
          <>
            {/* the two numbers that matter, in the order they matter */}
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[12px] border border-line-light bg-white px-6 py-5">
                <div className="font-mono text-[9.5px] tracking-[0.12em] text-ink-hush uppercase">
                  9999 suspense — unreconciled
                </div>
                <div className="mt-2">
                  <Money
                    paise={paise(tb.suspense.netPaise)}
                    tone={BigInt(tb.suspense.netPaise) === 0n ? "signal" : "refused"}
                    className="text-[26px]"
                  />
                </div>
                <p className="mt-2 max-w-[44ch] font-mono text-[10.5px] leading-relaxed text-ink-hush">
                  {tb.suspense.lines} line{tb.suspense.lines === 1 ? "" : "s"}. This is the exception
                  register expressed in rupees — the figure a controller reads first.
                </p>
              </div>

              <div className="rounded-[12px] border border-line-light bg-white px-6 py-5">
                <div className="font-mono text-[9.5px] tracking-[0.12em] text-ink-hush uppercase">
                  debits − credits
                </div>
                <div
                  className={`mt-2 font-mono text-[26px] tnum ${
                    tb.balanced ? "text-signal-deep" : "text-refused"
                  }`}
                >
                  {tb.balanced ? "0.00" : <Money paise={paise(tb.totals.deltaPaise)} tone="refused" />}
                </div>
                <p className="mt-2 max-w-[44ch] font-mono text-[10.5px] leading-relaxed text-ink-hush">
                  {tb.balanced
                    ? "Computed, not assumed. Every entry is written with its lines in one statement, so a half-posted entry is not reachable."
                    : "Something wrote to journal_lines outside postEntry. That is a bug, not a rounding difference."}
                </p>
              </div>
            </div>

            <h2 className="mt-14 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
              Trial balance
            </h2>
            <div className="mt-4 overflow-x-auto rounded-[12px] border border-line-light bg-white">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr>
                    {["Account", "Lines", "Debit", "Credit"].map((h, i) => (
                      <th
                        key={h}
                        className={`border-b border-line-light px-5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-hush uppercase ${
                          i >= 2 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tb.accounts.map((a) => (
                    <tr key={a.account} className={a.account === "9999" ? "bg-paper" : ""}>
                      <td className="border-b border-line-light px-5 py-2.5">
                        <Link
                          href={`/ledger?runId=${runId}&account=${a.account}`}
                          className="font-mono text-[12px] hover:underline"
                        >
                          <span className="text-ink-hush">{a.account}</span> {a.name}
                        </Link>
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5 font-mono text-[11px] tnum text-ink-hush">
                        {a.lines}
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5 text-right">
                        {BigInt(a.debitPaise) === 0n ? (
                          <span className="font-mono text-[12px] text-ink-hush">—</span>
                        ) : (
                          <Money paise={paise(a.debitPaise)} className="text-[12px]" />
                        )}
                      </td>
                      <td className="border-b border-line-light px-5 py-2.5 text-right">
                        {BigInt(a.creditPaise) === 0n ? (
                          <span className="font-mono text-[12px] text-ink-hush">—</span>
                        ) : (
                          <Money paise={paise(a.creditPaise)} className="text-[12px]" />
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-5 py-3 font-mono text-[11px] tracking-[0.08em] uppercase">
                      Total
                    </td>
                    <td />
                    <td className="px-5 py-3 text-right">
                      <Money paise={paise(tb.totals.debitPaise)} className="text-[12px]" />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Money paise={paise(tb.totals.creditPaise)} className="text-[12px]" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-14 flex flex-wrap items-baseline gap-x-4">
              <h2 className="font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-hush uppercase">
                Journal
              </h2>
              {account ? (
                <Link
                  href={`/ledger?runId=${runId}`}
                  className="font-mono text-[10.5px] text-ink-hush underline hover:text-ink"
                >
                  clear account {account}
                </Link>
              ) : null}
            </div>
            {isErr(journal) ? (
              <p className="mt-4 font-mono text-[12px] text-refused">{journal.error}</p>
            ) : (
              <div className="mt-4 space-y-3">
                {journal.entries.map((e) => (
                  <div key={e.id} className="overflow-hidden rounded-[12px] border border-line-light bg-white">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-light px-5 py-2.5">
                      <span className="font-mono text-[11px] tnum">{e.entryDate}</span>
                      <span className="min-w-[200px] flex-1 text-[13px]">{e.memo}</span>
                      <span className="font-mono text-[10.5px] text-ink-hush">{e.sourceRef}</span>
                      {e.reversalOf ? (
                        <span className="font-mono text-[10px] tracking-[0.08em] text-refused uppercase">
                          reversal
                        </span>
                      ) : null}
                    </div>
                    <table className="w-full border-collapse">
                      <tbody>
                        {e.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="px-5 py-1.5 font-mono text-[11.5px]">
                              <span className="text-ink-hush">{l.account}</span>{" "}
                              <span className="text-ink-hush">{l.memo}</span>
                            </td>
                            <td className="w-[150px] px-5 py-1.5 text-right">
                              {BigInt(l.debitPaise) === 0n ? null : (
                                <Money paise={paise(l.debitPaise)} className="text-[11.5px]" />
                              )}
                            </td>
                            <td className="w-[150px] px-5 py-1.5 text-right">
                              {BigInt(l.creditPaise) === 0n ? null : (
                                <Money paise={paise(l.creditPaise)} className="text-[11.5px]" />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {journal.entries.length === 0 ? (
                  <p className="rounded-[12px] border border-dashed border-line-light px-6 py-10 text-center font-mono text-[12px] text-ink-hush">
                    No entries for this filter.
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </Wrap>
    </main>
  );
}
