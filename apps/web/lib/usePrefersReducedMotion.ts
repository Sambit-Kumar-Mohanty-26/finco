"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether the visitor has asked for reduced motion.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: reading the media
 * query during render would break hydration, and setting state inside an effect
 * causes a double render (and is flagged by react-hooks/set-state-in-effect).
 * This subscribes properly, so the value is derived rather than assigned, and
 * it also responds if the visitor changes the setting while the page is open.
 *
 * The server snapshot is `false` — the server cannot know — so the first client
 * paint matches the server, then reconciles.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
