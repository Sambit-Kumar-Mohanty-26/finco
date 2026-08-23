"use client";

import { useEffect, useState } from "react";
import { Container } from "./Section";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#refusal", label: "The refusal" },
  { href: "#scorecard", label: "Accuracy" },
  { href: "#limits", label: "Limitations" },
];

/**
 * Sticky, single row.
 *
 * The spec says "dark over hero, light after", written before the page had
 * three dark bands. Taken literally it puts a paper bar over the refusal and
 * the CTA. So the nav reads the band it is currently sitting on and matches it:
 * transparent over ink, paper over paper. Same intent, generalised.
 *
 * The scroll listener is the only client JS in the page chrome. A CSS
 * scroll-timeline cannot pick a band, and unsupported browsers would be left
 * with light text on a paper background, which is unreadable rather than
 * merely unanimated.
 */
export function Nav() {
  const [onInk, setOnInk] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const bands = Array.from(
      document.querySelectorAll<HTMLElement>("[data-band]"),
    );

    // The v3 scene is one continuous room that warms with scroll, not a stack
    // of bands, so the bar follows the room. Band geometry cannot work here:
    // the final beat never reaches the top of the viewport, so the bar would
    // stay dark over the light payoff for the whole of the last screen.
    //
    // 0.92 is the same threshold the scene and the HUD use for full morning.
    const LIGHT_AT = 0.92;
    const update = () => {
      setScrolled(window.scrollY > 24);
      const max = document.body.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      setOnInk(p < LIGHT_AT);
      void bands;
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const bar = !scrolled
    ? "border-transparent bg-transparent"
    : onInk
      ? "border-line-dark bg-ink/80 backdrop-blur-md"
      : "border-line-light bg-paper/85 backdrop-blur-md";

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-[--dur-ui] ease-[var(--ease-ui)] ${bar}`}
    >
      <Container className="flex h-16 items-center justify-between gap-6">
        <a
          href="#top"
          className={`font-mono text-[13px] font-semibold tracking-[0.14em] uppercase transition-colors duration-[--dur-ui] ${
            onInk ? "text-on-ink" : "text-on-paper"
          }`}
        >
          Fin<span className="text-signal">Co</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-[14px] transition-colors duration-[--dur-micro] ease-[var(--ease-ui)] ${
                onInk
                  ? "text-on-ink-hush hover:text-on-ink"
                  : "text-on-paper-hush hover:text-on-paper"
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href="#cta"
          className={`rounded-[6px] px-4 py-2 font-mono text-[12px] tracking-[0.06em] transition-colors duration-[--dur-micro] ease-[var(--ease-ui)] ${
            onInk
              ? "bg-signal text-ink hover:bg-white"
              : "bg-ink text-on-ink hover:bg-on-paper"
          }`}
        >
          See a close run
        </a>
      </Container>
    </header>
  );
}
