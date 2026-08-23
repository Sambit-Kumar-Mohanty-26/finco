"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { Money } from "@/components/money/Money";
import { RUN, STAGES, SURFACED, TOTAL_ROWS } from "@/lib/fixtures/run";

/**
 * C1 — a close run executing.
 *
 * A stepped state machine, not a scrub: each tier completes and the counter
 * jumps to its real value. Digits never spin through wrong numbers, because
 * this is a product about exact arithmetic and a momentarily wrong figure
 * undercuts the claim.
 *
 * ~8s loop. Under reduced motion the machine is not started and the final
 * frame renders immediately (spec §5, rule 5).
 */

const HOLD_MS = 1600;
const STEP_MS = 900;
const LAST = STAGES.length - 1;

export function CloseRunDemo() {
  // Reduced motion is DERIVED, never assigned in an effect: the final frame is
  // simply what `active` resolves to, so there is no second render and no
  // hydration mismatch.
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const active = reduced ? LAST : step;

  useEffect(() => {
    if (reduced) return; // the designed final frame is already showing
    const id = setTimeout(
      () => setStep((s) => (s >= LAST ? 0 : s + 1)),
      active === LAST ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(id);
  }, [reduced, active]);

  const matched = STAGES[active].matched;
  const residual = TOTAL_ROWS - matched;
  const pct = (matched / TOTAL_ROWS) * 100;
  const done = active === LAST;

  return (
    <div className="w-full rounded-[10px] border border-line-dark bg-ink-soft">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-line-dark px-4 py-3">
        <span className="font-mono text-[11px] tracking-[0.04em] text-on-ink-hush">
          {RUN.id}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors duration-[--dur-ui] ${
            done ? "text-signal" : "text-on-ink-hush"
          }`}
        >
          <span
            className={`block h-1.5 w-1.5 rounded-full ${
              done ? "bg-signal" : "bg-on-ink-hush"
            }`}
          />
          {done ? "scored" : "running"}
        </span>
      </div>

      {/* counters */}
      <div className="grid grid-cols-3 border-b border-line-dark">
        <Counter label="matched" value={matched.toLocaleString("en-IN")} />
        <Counter
          label="residual"
          value={residual.toLocaleString("en-IN")}
          className="border-x border-line-dark"
        />
        <Counter
          label="auto-match"
          value={done ? RUN.autoMatch : `${pct.toFixed(1)}%`}
          tone={done ? "signal" : "default"}
        />
      </div>

      {/* meter */}
      <div className="px-4 pt-4">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-[--dur-morph] ease-[var(--ease-morph)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* stages */}
      <ol className="flex flex-col gap-0 px-4 py-3" role="list">
        {STAGES.map((s, i) => {
          const state = i < active ? "done" : i === active ? "running" : "pending";
          return (
            <li
              key={s.key}
              className="flex items-center gap-3 py-[7px] transition-opacity duration-[--dur-ui] ease-[var(--ease-ui)]"
              style={{ opacity: state === "pending" ? 0.32 : 1 }}
            >
              <StageMark state={state} kind={s.kind} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[11.5px] text-on-ink">
                  {s.label}
                </span>
                <span className="block font-mono text-[10px] text-on-ink-hush">
                  {s.detail}
                </span>
              </span>
              {state !== "pending" ? (
                <span className="font-mono text-[11px] tnum text-on-ink-hush">
                  {s.rightLabel ?? s.matched.toLocaleString("en-IN")}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* the exception that surfaces at the end */}
      <div className="border-t border-line-dark px-4 py-3">
        {done ? (
          <div
            className="flex items-start gap-3"
            style={{
              animation:
                "slideUpAndFade var(--dur-morph) var(--ease-enter) both",
            }}
          >
            <span className="mt-[2px] shrink-0 border border-refused px-1.5 py-[1px] font-mono text-[9.5px] font-semibold tracking-[0.08em] text-refused">
              ESCALATE
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[11px] text-on-ink">
                {SURFACED.code} {SURFACED.name} ·{" "}
                <Money paise={SURFACED.amount} />
              </span>
              <span className="block font-mono text-[10px] leading-relaxed text-on-ink-hush">
                {SURFACED.reason}
              </span>
            </span>
          </div>
        ) : (
          <span className="block font-mono text-[10px] text-on-ink-hush">
            {residual.toLocaleString("en-IN")} rows still unproven
          </span>
        )}
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  tone = "default",
  className = "",
}: {
  label: string;
  value: string;
  tone?: "default" | "signal";
  className?: string;
}) {
  return (
    <div className={`px-4 py-3.5 ${className}`}>
      <div
        className={`font-mono text-[19px] font-medium tnum tracking-[-0.01em] transition-colors duration-[--dur-ui] ${
          tone === "signal" ? "text-signal" : "text-on-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[9.5px] tracking-[0.12em] text-on-ink-hush uppercase">
        {label}
      </div>
    </div>
  );
}

function StageMark({
  state,
  kind,
}: {
  state: "done" | "running" | "pending";
  kind: "deterministic" | "agent" | "gate";
}) {
  const colour =
    kind === "agent" ? "bg-proposed" : kind === "gate" ? "bg-signal" : "bg-proven";
  if (state === "done")
    return <span className={`h-2 w-2 shrink-0 rounded-full ${colour}`} />;
  if (state === "running")
    return (
      <span className="relative h-2 w-2 shrink-0">
        <span className={`absolute inset-0 rounded-full ${colour}`} />
        <span
          className={`absolute inset-0 rounded-full ${colour} opacity-40`}
          style={{ animation: "scaleIn 700ms var(--ease-ui) infinite alternate" }}
        />
      </span>
    );
  return <span className="h-2 w-2 shrink-0 rounded-full border border-white/25" />;
}
