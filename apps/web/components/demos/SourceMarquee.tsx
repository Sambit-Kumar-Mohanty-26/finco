import { SOURCES } from "@/lib/fixtures/cash.ts";

/**
 * C5 — the sources, drifting.
 *
 * An ambient loop that represents something real: the systems this reconciles
 * across. Two copies of the list translate by -50%, so the seam never shows.
 * Masked at both edges. Paused entirely under reduced motion.
 */
export function SourceMarquee() {
  const run = [...SOURCES, ...SOURCES];
  return (
    <div className="border-y border-line-dark bg-ink py-8" data-band="ink">
      <div className="mask-edges overflow-hidden">
        <div
          className="flex w-max gap-14 whitespace-nowrap motion-reduce:animate-none"
          style={{ animation: "marquee var(--dur-ambient) linear infinite" }}
        >
          {run.map((s, i) => (
            <span
              key={`${s}-${i}`}
              aria-hidden={i >= SOURCES.length}
              className="font-mono text-[13px] tracking-[0.06em] text-on-ink-hush"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
