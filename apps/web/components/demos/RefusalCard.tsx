"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { Money } from "@/components/money/Money";
import { bankLine, candidates, verdict } from "@/lib/fixtures/landing";
import { formatINR } from "@finco/core";

/**
 * C2 — the refusal.
 *
 * Plays once when it scrolls into view, then holds. It never selects a
 * candidate: a visitor who watches it expecting a resolution and does not get
 * one has understood the product.
 *
 * Beats: evidence -> UTR underline -> candidate A -> candidate B -> hold ->
 * ESCALATE. Under reduced motion every beat is already past and the final
 * composition renders immediately.
 */
const BEATS = [0, 500, 1100, 2000, 3000, 3600];
const FINAL = BEATS.length - 1;

export function RefusalCard() {
  // Reduced motion is derived, not assigned in an effect — see CloseRunDemo.
  const reduced = usePrefersReducedMotion();
  const [played, setPlayed] = useState(-1);
  const beat = reduced ? FINAL : played;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect(); // plays once, never loops
        BEATS.forEach((at, i) => timers.push(setTimeout(() => setPlayed(i), at)));
      },
      { threshold: 0.35 },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const shown = (i: number) => beat >= i;

  return (
    <div
      ref={ref}
      className="grid overflow-hidden rounded-[12px] border border-line-dark bg-ink-soft lg:grid-cols-2"
    >
      {/* evidence */}
      <div className="border-b border-line-dark p-6 md:p-8 lg:border-r lg:border-b-0">
        <div className="font-mono text-[9.5px] tracking-[0.14em] text-on-ink-hush uppercase">
          Evidence
        </div>

        <div
          className="mt-5 transition-all duration-[750ms] ease-[var(--ease-enter)]"
          style={{
            opacity: shown(0) ? 1 : 0,
            transform: shown(0) ? "none" : "translateY(12px)",
          }}
        >
          <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-on-ink-hush">
            <span>{bankLine.id}</span>
            <span>{bankLine.valueDate}</span>
          </div>
          <div className="mt-2">
            <Money paise={bankLine.credit} className="text-[26px] font-medium" />
          </div>

          <div className="mt-6 border-t border-line-dark pt-5">
            <div className="font-mono text-[9.5px] tracking-[0.14em] text-on-ink-hush uppercase">
              Bank narration
            </div>
            <p className="mt-3 font-mono text-[12px] leading-relaxed break-all text-on-ink">
              {bankLine.narration.split(bankLine.utrFragment)[0]}
              <span className="relative inline-block text-signal">
                {bankLine.utrFragment}
                <span
                  className="absolute -bottom-[3px] left-0 block h-[2px] w-full origin-left bg-signal transition-transform duration-[500ms] ease-[var(--ease-enter)]"
                  style={{ transform: shown(1) ? "scaleX(1)" : "scaleX(0)" }}
                />
              </span>
              {bankLine.narration.split(bankLine.utrFragment)[1]}
            </p>
            <p className="mt-4 font-mono text-[10.5px] text-on-ink-hush">
              UTR fragment recovered · {Math.round(bankLine.utrConfidence * 100)}%
              confidence · truncated at {bankLine.truncatedAt} chars (
              {bankLine.bankFormat})
            </p>
          </div>
        </div>
      </div>

      {/* candidates + verdict */}
      <div className="flex flex-col p-6 md:p-8">
        <div className="font-mono text-[9.5px] tracking-[0.14em] text-on-ink-hush uppercase">
          Candidates — both sum exactly
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {candidates.map((c, i) => (
            <div
              key={c.id}
              className="rounded-[8px] border border-line-dark bg-white/[0.02] p-4 transition-all duration-[900ms] ease-[var(--ease-enter)]"
              style={{
                opacity: shown(2 + i) ? 1 : 0,
                transform: shown(2 + i) ? "none" : "translateY(16px)",
              }}
            >
              <div className="font-mono text-[12px] text-on-ink">
                {c.settlements.map((s) => s.id).join("  +  ")}
              </div>
              <div className="mt-2 font-mono text-[11.5px] text-on-ink-hush">
                {c.settlements.map((s) => formatINR(s.amount)).join("  +  ")}
              </div>
              <div className="mt-2 flex items-baseline gap-2 font-mono text-[11.5px]">
                <span className="text-on-ink-hush">=</span>
                <Money paise={c.sum} className="text-[13px] font-medium" />
                <span className="text-signal">exact</span>
              </div>
            </div>
          ))}
        </div>

        {/* the refusal. neither candidate is ever selected. */}
        <div
          className="mt-5 rounded-[8px] border border-refused bg-refused/[0.08] p-4 transition-all duration-[600ms] ease-[var(--ease-enter)]"
          style={{
            opacity: shown(5) ? 1 : 0,
            transform: shown(5) ? "none" : "scale(0.97)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="border border-refused px-2 py-[2px] font-mono text-[10px] font-semibold tracking-[0.1em] text-refused">
              ESCALATE
            </span>
            <span className="font-mono text-[11px] text-on-ink-hush">
              {verdict.reason}
            </span>
          </div>
          <p className="mt-3 border-t border-refused/25 pt-3 font-mono text-[10.5px] leading-relaxed text-on-ink-hush">
            <span className="text-proposed">{verdict.agentModel}</span> proposed
            “{verdict.agentClaim}”. The verifier disagreed, and the model&rsquo;s
            claim is shipped next to the verdict rather than hidden.
          </p>
        </div>
      </div>
    </div>
  );
}
