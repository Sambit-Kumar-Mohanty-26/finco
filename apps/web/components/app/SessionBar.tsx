"use client";

import Link from "next/link";
import { apiSend } from "@/lib/api";
import { useMe } from "@/lib/useMe";

/**
 * Who you are, in the header.
 *
 * The role is shown, not just the name, because every refusal in this app is
 * phrased in terms of it — "a write-off needs the approver role" only helps if
 * you can see that you are a preparer.
 */
export function SessionBar() {
  const { me, loading } = useMe();

  if (loading) return <span className="ml-auto font-mono text-[11px] text-ink-hush">…</span>;

  if (!me) {
    return (
      <Link href="/login" className="ml-auto font-mono text-[11px] text-ink-hush hover:text-ink">
        Sign in
      </Link>
    );
  }

  return (
    <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-ink-hush">
      <span className="text-ink">{me.email}</span>
      <span className="border border-line-light px-1.5 py-[1px] tracking-[0.08em] uppercase">
        {me.role}
      </span>
      <button
        onClick={async () => {
          await apiSend("/v1/auth/logout");
          // A full reload, deliberately, not a soft navigation. Every client
          // component that asked who you are holds the answer in its own state,
          // and a soft nav leaves all of them showing a session that no longer
          // exists. Throwing the whole page away is the only way to be sure.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }}
        className="hover:text-ink"
      >
        Sign out
      </button>
    </span>
  );
}
