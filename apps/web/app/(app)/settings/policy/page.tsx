import { Wrap } from "@/components/layout/Wrap";
import { PolicyForm } from "@/components/app/PolicyForm";
import { SettingsNav } from "@/components/app/SettingsNav";
import { apiGet, isErr, type AuditEntry, type EffectivePolicy } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Policy, and the record of who changed it.
 *
 * The audit chain is shown on the SAME page as the control, not filed away
 * under a separate tab nobody opens. "Who widened the autonomy cap, and when"
 * has to be answerable at the moment somebody is about to widen it again.
 */
export default async function PolicyPage() {
  const [policy, audit] = await Promise.all([
    apiGet<EffectivePolicy>("/v1/settings/policy"),
    apiGet<{ entries: AuditEntry[]; chain: { ok: boolean; brokenAtSeq?: number; why?: string } }>(
      "/v1/settings/audit",
    ),
  ]);

  return (
    <main className="py-8 sm:py-12">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P8 · policy
        </span>
        <h1 className="mt-4 font-display text-[clamp(26px,3.2vw,38px)] leading-[1.06] tracking-[-0.02em]">
          What may post without a person.
        </h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-ink-hush">
          These numbers used to live in environment variables, which meant changing them was a
          redeploy and nobody could say when they last changed. They live in the database now, per
          tenant, and every change is a link in a hash chain.
        </p>

        <SettingsNav active="policy" />

        {isErr(policy) ? (
          <p className="mt-10 font-mono text-[13px] text-refused">{policy.error}</p>
        ) : (
          <PolicyForm initial={policy} />
        )}

        <h2 className="mt-14 text-[15px] font-medium">Who changed what</h2>
        {isErr(audit) ? (
          <p className="mt-3 font-mono text-[12px] text-ink-hush">{audit.error}</p>
        ) : (
          <>
            {/* The verdict is recomputed on every read. A stored "this is fine"
                flag is exactly the thing an edit would also update. */}
            <p
              className={`mt-2 font-mono text-[11.5px] ${audit.chain.ok ? "text-ink-hush" : "text-refused"}`}
            >
              {audit.chain.ok
                ? `chain verifies · ${audit.entries.length} entries`
                : `CHAIN BROKEN at entry ${audit.chain.brokenAtSeq} — ${audit.chain.why}`}
            </p>
            {audit.entries.length === 0 ? (
              <p className="mt-3 font-mono text-[12px] text-ink-hush">Nothing recorded yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-[12px] border border-line-light bg-white">
                <table className="w-full min-w-[560px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {["#", "When", "Who", "Action", "Subject", "Hash"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="border-b border-line-light px-4 py-2.5 text-left font-mono text-[9.5px] font-semibold tracking-[0.12em] text-ink-hush uppercase"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.entries].reverse().map((e) => (
                      <tr key={e.seq}>
                        <td className="border-b border-line-light px-4 py-2.5 font-mono text-[11px] tnum text-ink-hush">
                          {e.seq}
                        </td>
                        <td className="border-b border-line-light px-4 py-2.5 font-mono text-[11px] text-ink-hush">
                          {e.at.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="border-b border-line-light px-4 py-2.5 text-[12.5px]">{e.actorEmail}</td>
                        <td className="border-b border-line-light px-4 py-2.5 font-mono text-[11.5px]">
                          {e.action}
                        </td>
                        <td className="border-b border-line-light px-4 py-2.5 font-mono text-[11px] text-ink-hush">
                          {e.subjectType} {e.subjectRef.slice(0, 12)}
                        </td>
                        <td className="border-b border-line-light px-4 py-2.5 font-mono text-[10.5px] text-ink-hush">
                          {e.hash}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Wrap>
    </main>
  );
}
