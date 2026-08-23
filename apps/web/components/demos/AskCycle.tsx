"use client";

import { useEffect, useState } from "react";
import { ASKS } from "@/lib/fixtures/cash.ts";

/**
 * C6 — grounded question and answer.
 *
 * Cycles four real questions. The fourth is a refusal, and it is styled as a
 * normal answer rather than an error, because refusing is correct behaviour and
 * the interface should not teach people otherwise.
 *
 * Every answer shows the rows it came from. An answer without rows is only
 * shown when there are none to show, and then it says so.
 */
const DWELL = 4200;

export function AskCycle({ dark = false }: { dark?: boolean }) {
  const card = dark ? "border-white/10 bg-black/35 backdrop-blur-sm" : "border-line-light bg-white";
  const rule = dark ? "border-white/10" : "border-line-light";
  const ink = dark ? "text-on-ink" : "text-on-paper";
  const hush = dark ? "text-white/45" : "text-on-paper-hush";
  const chip = dark ? "border-white/10 bg-white/[0.04] text-white/50" : "border-line-light bg-paper-cool text-on-paper-hush";
  const accent = dark ? "text-signal" : "text-signal-deep";
  const dot = dark ? "bg-signal" : "bg-signal-deep";
  const dotOff = dark ? "bg-white/15 hover:bg-white/35" : "bg-line-light hover:bg-on-paper-hush";
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (paused) return;
    const id = setTimeout(() => setI((n) => (n + 1) % ASKS.length), DWELL);
    return () => clearTimeout(id);
  }, [i, paused]);

  const ask = ASKS[i];

  return (
    <div
      className={`overflow-hidden rounded-[12px] border ${card}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* the query line */}
      <div className={`flex items-center gap-3 border-b ${rule} px-5 py-4`}>
        <span className={`font-mono text-[12px] ${accent}`}>›</span>
        <span key={`q-${i}`} className={`min-w-0 flex-1 font-mono text-[12.5px] ${ink}`}
          style={{ animation: "fadeInCopy var(--dur-ui) var(--ease-ui) both" }}>
          {ask.q}
        </span>
      </div>

      <div key={`a-${i}`} className="px-5 py-5"
        style={{ animation: "slideUpAndFade var(--dur-morph) var(--ease-enter) both" }}>
        <p className={`max-w-[62ch] text-[16px] leading-[1.55] ${ask.grounded ? ink : hush}`}>
          {ask.a}
        </p>

        {ask.rows.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1.5" role="list">
            {ask.rows.map((r) => (
              <li
                key={r}
                className={`rounded-[6px] border ${chip} px-3 py-2 font-mono text-[11px]`}
              >
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-4 inline-block border ${chip} px-3 py-2 font-mono text-[10.5px]`}>
            no supporting rows — nothing in this run grounds an answer
          </p>
        )}
      </div>

      {/* which question is showing; also the dwell affordance */}
      <div className={`flex items-center gap-2 border-t ${rule} px-5 py-3`}>
        {ASKS.map((a, n) => (
          <button
            key={a.q}
            onClick={() => setI(n)}
            aria-label={`Show: ${a.q}`}
            aria-current={n === i}
            className={`h-[3px] w-8 rounded-full transition-colors duration-[--dur-ui] ${
              n === i ? dot : dotOff
            }`}
          />
        ))}
        <span className={`ml-auto font-mono text-[10px] ${hush}`}>
          grounded in the provenance graph
        </span>
      </div>
    </div>
  );
}
