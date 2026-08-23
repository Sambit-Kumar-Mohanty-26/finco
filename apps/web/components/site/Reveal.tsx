"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Play once, when the section is properly in front of the reader.
 *
 * Replaces the scroll-linked `animation-timeline: view()` approach, whose
 * range finished long before the section was on screen — you arrived to find
 * the animation already spent. This fires on real intersection instead.
 *
 * The trigger is deliberately late: the element's top has to clear the bottom
 * 22% of the viewport before it plays, so the whole arc happens in view rather
 * than half of it below the fold.
 *
 * Safety: no IntersectionObserver → reveal immediately, and a <noscript> rule
 * covers JS being off. There is deliberately NO timer backstop: an earlier
 * version revealed everything 3s after mount, which fired before the reader
 * had scrolled anywhere and reintroduced the exact "the animation already
 * happened" bug this component exists to fix.
 */
export function Reveal({
  children,
  as: Tag = "div",
  className = "",
  variant = "arc",
  stagger = false,
  from = "left",
  delay = 0,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  variant?: "arc" | "frame";
  stagger?: boolean;
  /** which side the element swings in from */
  from?: "left" | "right";
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => el.classList.add("rv-in");

    if (typeof IntersectionObserver === "undefined") {
      show();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show();
            io.disconnect();
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px -14% 0px" },
    );
    io.observe(el);

    return () => io.disconnect();
  }, []);

  const style: Record<string, string | number> = {
    "--dx": from === "right" ? 1 : -1,
  };
  if (delay) style["--rv-delay"] = `${delay}ms`;

  return (
    <Tag
      ref={ref}
      // a stack animates its children; it must not also animate itself
      className={`rv ${stagger ? "rv-stack" : `rv-${variant}`} ${className}`}
      style={style as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
