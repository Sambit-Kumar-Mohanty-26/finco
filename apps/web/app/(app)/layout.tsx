import Link from "next/link";
import type { ReactNode } from "react";
import { Wrap } from "@/components/layout/Wrap";
import { SessionBar } from "@/components/app/SessionBar";
import { apiGet, isErr, type EffectivePolicy } from "@/lib/api";

const NAV = [
  { href: "/datasets", label: "Datasets" },
  { href: "/runs", label: "Runs" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/ledger", label: "Ledger" },
  { href: "/cash", label: "Cash" },
  { href: "/periods", label: "Close" },
  { href: "/settings/connections", label: "Settings" },
  { href: "/status", label: "Status" },
];

/**
 * The dashboard shell. Same app as the marketing site, separate route group —
 * so the product screens and the "screenshots" on the landing page are the same
 * components rendering the same data, and marketing cannot drift from product.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  /**
   * The kill switch banner, on EVERY screen.
   *
   * In the layout rather than on the pages that post, because the screen
   * somebody happens to be looking at when they wonder "why did nothing post
   * last night" is rarely the one that would have posted it. A control whose
   * state is only visible where it applies is a control people forget is on.
   */
  const policy = await apiGet<EffectivePolicy>("/v1/settings/policy");
  const killed = !isErr(policy) && policy.killSwitch;

  return (
    <div className="min-h-[100svh] bg-paper">
      {killed ? (
        <div role="status" className="border-b border-refused/30 bg-refused/[0.09]">
          <Wrap className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-refused uppercase">
              kill switch on
            </span>
            <span className="text-[13px] leading-[1.4] text-refused">
              Nothing posts automatically. Every outcome routes to review.
              {(policy as EffectivePolicy).killReason ? ` — ${(policy as EffectivePolicy).killReason}` : ""}
            </span>
            <Link
              href="/settings/policy"
              className="font-mono text-[11px] text-refused underline underline-offset-2"
            >
              policy →
            </Link>
          </Wrap>
        </div>
      ) : null}
      <header className="border-b border-line-light">
        {/* Wraps rather than scrolls: eight nav items do not fit on a 360 px
            phone, and a header that scrolls sideways drags the page with it. */}
        <Wrap className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1 py-2">
          <Link href="/" className="font-display text-[17px] tracking-[-0.01em]">
            FinCo
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] tracking-[0.04em] text-ink-hush">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <SessionBar />
        </Wrap>
      </header>
      {children}
    </div>
  );
}
