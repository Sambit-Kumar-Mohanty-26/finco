import { Wrap } from "@/components/layout/Wrap";
import { SettingsNav } from "@/components/app/SettingsNav";
import { apiGet, isErr, type Connections } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Connections, each proved by a real row.
 *
 * A green tick that means "the credentials parsed" is a lie waiting to happen:
 * a key can be perfectly valid while the feed returns nothing, and a page that
 * says CONNECTED over an empty table is worse than one that says nothing at
 * all. So every source here shows the newest row it actually has. No row, no
 * tick, however healthy the credentials look.
 */

const TONE: Record<string, string> = {
  OK: "text-signal-deep",
  "NO DATA": "text-refused",
  "NOT CONFIGURED": "text-ink-hush",
};

export default async function ConnectionsPage() {
  const data = await apiGet<Connections>("/v1/settings/connections");

  return (
    <main className="py-8 sm:py-12">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P8 · connections
        </span>
        <h1 className="mt-4 font-display text-[clamp(26px,3.2vw,38px)] leading-[1.06] tracking-[-0.02em]">
          Every source, proved by a row.
        </h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-ink-hush">
          Not &ldquo;the credentials are valid&rdquo; — the newest thing each feed actually delivered.
        </p>

        <SettingsNav active="connections" />

        {isErr(data) ? (
          <p className="mt-10 font-mono text-[13px] text-refused">{data.error}</p>
        ) : (
          <>
            <div className="mt-8 overflow-x-auto rounded-[12px] border border-line-light bg-white">
              <table className="w-full min-w-[520px] border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    {["Source", "Status", "Rows", "Newest row"].map((h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={`border-b border-line-light px-4 py-2.5 font-mono text-[9.5px] font-semibold tracking-[0.12em] text-ink-hush uppercase ${
                          i === 2 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.key}>
                      <th scope="row" className="border-b border-line-light px-4 py-3 text-left font-medium">
                        {s.label}
                        {s.signatureFailures ? (
                          <span className="mt-0.5 block font-mono text-[10.5px] font-normal text-refused">
                            {s.signatureFailures} signature failures — the secret here and the one in the
                            Razorpay dashboard do not match
                          </span>
                        ) : null}
                      </th>
                      <td
                        className={`border-b border-line-light px-4 py-3 font-mono text-[11px] tracking-[0.06em] ${TONE[s.status]}`}
                      >
                        {s.status}
                      </td>
                      <td className="border-b border-line-light px-4 py-3 text-right font-mono text-[12px] tnum text-ink-hush">
                        {s.rows ? s.rows.toLocaleString("en-IN") : "—"}
                      </td>
                      <td className="border-b border-line-light px-4 py-3 font-mono text-[11px] text-ink-hush">
                        {s.newest ?? "nothing yet"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* The one coverage number that caps the achievable match rate,
                with the fix named — because the fix is a gateway setting, not
                anything this engine can do better. */}
            <div className="mt-6 rounded-[12px] border border-line-light bg-white px-5 py-4">
              <h2 className="text-[14px] font-medium">order_receipt coverage</h2>
              <p className="mt-2 font-mono text-[clamp(22px,5vw,28px)] tnum">
                {data.orderReceiptCoverage.pct === null ? "—" : `${data.orderReceiptCoverage.pct}%`}
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink-hush">
                {data.orderReceiptCoverage.rowsWithReceipt.toLocaleString("en-IN")} of{" "}
                {data.orderReceiptCoverage.rowsTotal.toLocaleString("en-IN")} rows carry one
              </p>
              <p className="mt-3 max-w-[62ch] text-[13px] leading-[1.5] text-ink-hush">
                {data.orderReceiptCoverage.fix}
              </p>
            </div>
          </>
        )}
      </Wrap>
    </main>
  );
}
