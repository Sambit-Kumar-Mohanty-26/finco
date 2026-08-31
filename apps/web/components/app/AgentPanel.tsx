import { formatINR, paise } from "@finco/core";
import { Money } from "@/components/money/Money";
import type { AgentSummary, Judged } from "@/lib/api";

/**
 * What the model said, next to what the verifier said about it.
 *
 * The rule this component exists to enforce visually: a model claim is never
 * shown alone. Every row carries the claim AND the verdict, side by side, so
 * there is no state of the UI in which a reader sees a confident sentence from
 * a language model without also seeing whether the arithmetic held. A PROPOSED
 * row is drawn dashed and names the model inline — dashed because it has not
 * been proven, named because "the system thinks" is not accountable and
 * "gemini-2.5-pro thinks" is.
 *
 * Nothing here is a control. The model proposes; the verifier disposes; this
 * panel reports. A button that let somebody accept a claim from this screen
 * would make the verifier optional, which is the whole thing it is for.
 */

const VERDICT_TONE: Record<string, string> = {
  ACCEPT: "border-signal-deep text-signal-deep",
  REJECT: "border-refused text-refused",
  ESCALATE: "border-refused text-refused",
};

export function AgentPanel({ judged, agent }: { judged: Judged[]; agent?: AgentSummary }) {
  const fromModel = judged.filter((j) => j.source === "T5");
  const disagreed = fromModel.filter((j) => j.verdict !== "ACCEPT");
  const usage = agent?.usage ?? null;
  const notes = agent?.notes ?? [];

  if (fromModel.length === 0 && notes.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-line-light bg-white px-6 py-8">
        <p className="max-w-[70ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
          The model tier was not called. Five deterministic tiers left nothing unexplained, so there
          was no residual to reason about — the cheapest possible model call is the one that never
          happens, and it is also the one that cannot hallucinate.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-line-light bg-white">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-light px-5 py-3">
        <span className="font-mono text-[11px] tracking-[0.08em] text-proposed uppercase">
          {fromModel[0]?.model ?? "gemini-2.5-pro"}
        </span>
        {usage ? (
          <>
            <span className="font-mono text-[11px] text-ink-hush">
              {usage.rounds} round{usage.rounds === 1 ? "" : "s"}
            </span>
            <span className="font-mono text-[11px] text-ink-hush">
              {usage.inputTokens.toLocaleString("en-IN")} in ·{" "}
              {usage.outputTokens.toLocaleString("en-IN")} out
            </span>
            <span className="font-mono text-[11px] text-ink-hush">
              {formatINR(paise(usage.costPaise))}
            </span>
            {usage.cached ? (
              <span className="font-mono text-[10.5px] text-signal-deep">
                cached — replay cost nothing
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      {notes.length > 0 ? (
        <div className="border-b border-line-light px-5 py-4">
          <p className="font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
            what the model reported
          </p>
          <ul className="mt-2 space-y-1">
            {notes.map((n, i) => (
              <li key={i} className="max-w-[80ch] font-mono text-[11.5px] leading-relaxed text-ink">
                {n}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {fromModel.map((j, i) => (
        <div
          key={`${j.bankRef}-${i}`}
          className={`grid gap-4 px-5 py-4 md:grid-cols-2 ${
            j.verdict === "ACCEPT"
              ? "border-t border-line-light"
              : "border-t border-dashed border-proposed/40"
          }`}
        >
          {/* the claim */}
          <div>
            <span className="inline-block border border-dashed border-proposed px-1.5 py-[1px] font-mono text-[10px] font-semibold tracking-[0.08em] text-proposed">
              PROPOSED · {j.model ?? "model"}
            </span>
            <p className="mt-2 font-mono text-[12px]">
              {j.bankRef} → {j.settlementRefs.join(", ")}
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-ink-hush">basis {j.basis}</p>
            {j.claim ? (
              <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-ink-hush italic">
                “{j.claim}”
              </p>
            ) : null}
          </div>

          {/* the verdict, always */}
          <div className="md:border-l md:border-line-light md:pl-4">
            <span
              className={`inline-block border px-1.5 py-[1px] font-mono text-[10px] font-semibold tracking-[0.08em] ${
                VERDICT_TONE[j.verdict] ?? "border-line-light text-ink-hush"
              }`}
            >
              VERIFIER · {j.verdict}
            </span>
            <p className="mt-2 max-w-[60ch] font-mono text-[11.5px] leading-relaxed text-ink">
              {j.reason}
            </p>
            {BigInt(j.proposerDeltaPaise) !== 0n ? (
              <p className="mt-2 font-mono text-[11px] text-refused">
                the model&rsquo;s own arithmetic was off by{" "}
                <Money paise={paise(j.proposerDeltaPaise)} tone="refused" className="text-[11px]" />
              </p>
            ) : null}
          </div>
        </div>
      ))}

      {disagreed.length > 0 ? (
        <div className="border-t border-line-light bg-paper px-5 py-4">
          <p className="font-mono text-[10px] tracking-[0.12em] text-refused uppercase">
            verifier disagreed · {disagreed.length} of {fromModel.length}
          </p>
          <p className="mt-2 max-w-[76ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
            None of these reached the ledger. A rejection is the system working: the model is a
            proposer with no posting rights, and a claim that fails the identity — or that closes
            but is above the autonomy cap — becomes an item for a person rather than a journal
            entry. The rejection text above is what the model was told, so the next round could
            correct itself.
          </p>
        </div>
      ) : null}
    </div>
  );
}
