"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Words that rise into place on a spring.
 *
 * Split on spaces, each word gets an index the CSS uses for its delay. Spaces
 * are preserved as real characters so selection and screen readers are
 * unaffected — the whole heading is still one readable string.
 */
export function Words({ children }: { children: string }) {
  const parts = children.split(" ");
  return (
    <span className="words">
      {parts.map((w, i) => (
        <span key={`${w}-${i}`} style={{ ["--i" as string]: i }}>
          {w}
          {i < parts.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * A product surface with weight.
 *
 * Follows the pointer with a small parallax tilt, spring-damped, so the frame
 * reads as a physical object catching light rather than a flat image. The
 * rotation is deliberately tiny — past about two degrees it stops looking
 * expensive and starts looking like a template.
 *
 * Pointer-only: touch never triggers it, and reduced motion disables it.
 */
export function Tilt({
  children,
  className = "",
  max = 1.6,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;

    const tick = () => {
      // critically-damped follow: no overshoot, just an unhurried settle
      cx += (tx - cx) * 0.075;
      cy += (ty - cy) * 0.075;
      el.style.transform = `perspective(2000px) rotateX(${cy.toFixed(3)}deg) rotateY(${cx.toFixed(3)}deg)`;
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tx = px * max * 2;
      ty = -py * max * 2;
      start();
    };

    const onLeave = () => {
      tx = 0;
      ty = 0;
      start();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [max]);

  return (
    <div ref={ref} className={className} style={{ transformStyle: "preserve-3d" }}>
      {children}
    </div>
  );
}

/** Page-wide film grain. One inline SVG, no request, no animation cost. */
export function FilmGrain() {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23g)'/></svg>";
  return (
    <div
      aria-hidden="true"
      className="filmgrain"
      style={{ backgroundImage: `url("data:image/svg+xml,${svg}")` }}
    />
  );
}
