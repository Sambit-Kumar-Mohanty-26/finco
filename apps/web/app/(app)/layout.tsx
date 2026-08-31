import Link from "next/link";
import type { ReactNode } from "react";
import { Wrap } from "@/components/layout/Wrap";
import { SessionBar } from "@/components/app/SessionBar";

const NAV = [
  { href: "/datasets", label: "Datasets" },
  { href: "/runs", label: "Runs" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/ledger", label: "Ledger" },
  { href: "/status", label: "Status" },
];

/**
 * The dashboard shell. Same app as the marketing site, separate route group —
 * so the product screens and the "screenshots" on the landing page are the same
 * components rendering the same data, and marketing cannot drift from product.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100svh] bg-paper">
      <header className="border-b border-line-light">
        <Wrap className="flex h-14 items-center gap-6">
          <Link href="/" className="font-display text-[17px] tracking-[-0.01em]">
            FinCo
          </Link>
          <nav className="flex items-center gap-5 font-mono text-[11px] tracking-[0.04em] text-ink-hush">
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
