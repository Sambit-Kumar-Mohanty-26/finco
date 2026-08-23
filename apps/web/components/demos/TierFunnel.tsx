import { STAGES, TOTAL_ROWS } from "@/lib/fixtures/run";

/**
 * C3 — the funnel, made literal.
 *
 * Each row's bar is the residual still unproven after that tier. It narrows
 * because the tiers actually narrow it, so the metaphor and the data are the
 * same thing. The agent row does not narrow at all, which is the point: it
 * proposes, it does not post.
 *
 * Scroll-driven reveal via .enter-stack — no JS, no scroll listener.
 */
const KIND_BAR: Record<string, string> = {
  deterministic: "bg-proven",
  agent: "bg-proposed",
  gate: "bg-signal",
};

const KIND_NOTE: Record<string, string> = {
  deterministic: "deterministic",
  agent: "proposes only",
  gate: "verified",
};

export function TierFunnel({ dark = false }: { dark?: boolean }) {
  const rule = dark ? "border-white/8" : "border-line-light";
  const ink = dark ? "text-on-ink" : "text-on-paper";
  const hush = dark ? "text-white/40" : "text-on-paper-hush";
  const track = dark ? "bg-white/10" : "bg-line-light";
  return (
    <div className="enter-stack flex flex-col">
      {STAGES.map((s) => {
        const residual = TOTAL_ROWS - s.matched;
        const pct = (residual / TOTAL_ROWS) * 100;
        return (
          <div
            key={s.key}
            className={`grid grid-cols-[minmax(96px,150px)_1fr_auto] items-center gap-4 border-b ${rule} py-4 last:border-b-0 md:gap-6`}
          >
            <div className="min-w-0">
              <div className={`font-mono text-[12px] ${ink}`}>{s.label}</div>
              <div className={`mt-0.5 font-mono text-[10px] ${hush}`}>
                {KIND_NOTE[s.kind]}
              </div>
            </div>

            <div className={`h-[6px] w-full rounded-full ${track}`}>
              <div
                className={`h-full rounded-full ${KIND_BAR[s.kind]}`}
                style={{ width: `${Math.max(pct, 1.2)}%` }}
              />
            </div>

            <div className="text-right">
              <div className={`font-mono text-[13px] tnum ${ink}`}>
                {residual.toLocaleString("en-IN")}
              </div>
              <div className={`font-mono text-[9.5px] tracking-[0.1em] ${hush} uppercase`}>
                unproven
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
