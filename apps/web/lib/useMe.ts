"use client";

import { useEffect, useState } from "react";
import { API_BASE, type Actor } from "./api";

/**
 * Who is signed in, asked from the browser.
 *
 * It has to be the browser: the session cookie belongs to the API's origin, so
 * a Next server component cannot read it and there is nothing to forward. That
 * is a feature of the split, not a workaround — the API is the only thing that
 * decides who you are, and it decides again on every mutation regardless of
 * what this hook returned.
 *
 * So this is for the UI only. It chooses which controls to show and what to say
 * when one is unavailable. It is never a security boundary; the 403 is.
 */
export function useMe(): { me: Actor | null; loading: boolean } {
  const [me, setMe] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/v1/auth/me`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((a) => {
        if (!live) return;
        setMe(a as Actor | null);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return { me, loading };
}
