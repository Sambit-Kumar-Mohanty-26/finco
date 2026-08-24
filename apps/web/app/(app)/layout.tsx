import Link from "next/link";
import type { ReactNode } from "react";
import { Wrap } from "@/components/layout/Wrap";

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
            <Link href="/datasets" className="hover:text-ink">
              Datasets
            </Link>
            <Link href="/runs" className="hover:text-ink">
              Runs
            </Link>
            <Link href="/status" className="hover:text-ink">
              Status
            </Link>
          </nav>
        </Wrap>
      </header>
      {children}
    </div>
  );
}
