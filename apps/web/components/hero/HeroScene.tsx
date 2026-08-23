"use client";

import { useEffect, useRef, useState } from "react";
import { EnvironmentLayer } from "./EnvironmentLayer";
import { RunScreen } from "@/components/app/Screens";
import { Words } from "@/components/site/Motion";
import { STAGES } from "@/lib/fixtures/run.ts";

/**
 * The hero as one continuous camera move.
 *
 * Mechanism reverse-engineered from mercury.com: a tall track containing a
 * sticky viewport-height child. The pin lasts (track − viewport) pixels, and a
 * single normalised progress value drives everything.
 *
 *   track 2250px ─ sticky 100vh ─ pin travel = 1350px ─ progress 0 → 1
 *
 * Mercury maps that progress onto `video.currentTime`. We map it onto CSS
 * transforms instead, and the product stays live DOM. When the pin releases,
 * the run this camera just flew into starts executing — the hero's final frame
 * IS the run's first frame, which is what makes it read as one move rather
 * than two animations.
 *
 * One scroll listener, rAF-throttled, writing one custom property. No React
 * re-render while scrolling: `stage` is the only state and it changes 7 times.
 */

const STEP_MS = 780;
const LAST = STAGES.length - 1;
const START_AT = 0.97; // the run begins as the pin lets go

export function HeroScene() {
  const track = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);

  // --- camera -------------------------------------------------------------
  useEffect(() => {
    const el = track.current;
    if (!el) return;

    const mobile = window.matchMedia("(max-width: 639px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const read = () => {
      raf.current = 0;
      // no pin on mobile or under reduced motion: land on the final frame
      if (mobile.matches || reduced.matches) {
        el.style.setProperty("--hero-p", "1");
        setRunning(true);
        return;
      }
      const r = el.getBoundingClientRect();
      const travel = el.offsetHeight - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 1;
      el.style.setProperty("--hero-p", p.toFixed(4));
      if (p >= START_AT) setRunning(true);
    };

    const onScroll = () => {
      if (!raf.current) raf.current = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  // --- the run, once the camera has arrived -------------------------------
  useEffect(() => {
    if (!running || stage >= LAST) return;
    const id = setTimeout(() => setStage((s) => Math.min(s + 1, LAST)), STEP_MS);
    return () => clearTimeout(id);
  }, [running, stage]);

  return (
    <div ref={track} className="hero-track">
      <div className="hero-pin">
        <EnvironmentLayer />

        {/* copy — leads, then gets out of the camera's way */}
        <div className="hero-copy">
          <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
            Reconciliation &amp; close for Razorpay merchants
          </span>
          <h1 className="mt-6 font-display text-[clamp(40px,5.4vw,76px)] leading-[1.02] font-normal tracking-[-0.03em]">
            <Words>Every rupee proven, or named as unproven.</Words>
          </h1>
          <p className="mx-auto mt-6 max-w-[54ch] text-[19px] leading-[1.55] text-on-paper-hush">
            FinCo reconciles your settlements to your bank and your books, posts
            a balanced journal, and refuses every match it cannot close to zero
            paise.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#start"
              className="lift rounded-[8px] bg-on-paper px-6 py-3.5 text-[15px] text-white hover:bg-signal-deep"
            >
              Book a close review
            </a>
            <a
              href="#how"
              className="lift rounded-[8px] border border-line-light bg-white px-6 py-3.5 text-[15px] hover:border-on-paper/25"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* the product, live DOM, flown into and then executed */}
        <div className="hero-stage">
          <div className="hero-product">
            <RunScreen stage={stage} chromeVar />
          </div>
        </div>

        <span className="hero-hint nudge font-mono text-[10px] tracking-[0.28em] text-on-paper-hush uppercase">
          scroll
        </span>
      </div>
    </div>
  );
}
