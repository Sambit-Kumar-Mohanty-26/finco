"use client";

import { useEffect, useState } from "react";

/**
 * Product navigation, the way a real company has one.
 *
 * Two dropdowns, a flat set of links, log in and a primary CTA. This is the
 * single biggest thing separating "a real product site" from "a concept" —
 * the page has to look like a business stands behind it.
 */
const MENUS: Record<string, { label: string; note: string; href: string }[]> = {
  Product: [
    { label: "Reconciliation", note: "Razorpay, bank and ERP in one close", href: "#reconciliation" },
    { label: "Exception queue", note: "Typed, evidenced, owned, aged", href: "#exceptions" },
    { label: "Ledger & close", note: "Balanced journal, trial balance, period lock", href: "#ledger" },
    { label: "Cash position", note: "Fourteen-day forward view", href: "#cash" },
  ],
  Company: [
    { label: "Security", note: "Data residency, PCI scope, audit trail", href: "#security" },
    { label: "How it works", note: "Deterministic core, model at the edges", href: "#how" },
    { label: "Limitations", note: "What it does not do yet", href: "#limits" },
  ],
};

export function SiteNav() {
  const [open, setOpen] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-200 ease-[var(--ease-ui)] ${
        scrolled ? "border-line-light bg-paper/90 backdrop-blur-md" : "border-transparent bg-paper"
      }`}
      onMouseLeave={() => setOpen(null)}
    >
      <div className="mx-auto flex h-[64px] w-full max-w-[1440px] items-center gap-8 px-6 md:px-10 lg:px-14">
        <a href="#top" className="flex items-center gap-2.5" aria-label="FinCo — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="font-mono text-[14px] font-semibold tracking-[0.12em] uppercase">
            FinCo
          </span>
        </a>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {Object.keys(MENUS).map((k) => (
            <button
              key={k}
              onMouseEnter={() => setOpen(k)}
              onFocus={() => setOpen(k)}
              onClick={() => setOpen(open === k ? null : k)}
              aria-expanded={open === k}
              className={`rounded-[6px] px-3 py-2 text-[14.5px] transition-colors duration-150 ${
                open === k ? "text-on-paper" : "text-on-paper-hush hover:text-on-paper"
              }`}
            >
              {k}
            </button>
          ))}
          <a href="#pricing" className="rounded-[6px] px-3 py-2 text-[14.5px] text-on-paper-hush transition-colors hover:text-on-paper">
            Pricing
          </a>
          <a href="#docs" className="rounded-[6px] px-3 py-2 text-[14.5px] text-on-paper-hush transition-colors hover:text-on-paper">
            Docs
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a href="/login" className="hidden rounded-[6px] px-3 py-2 text-[14.5px] text-on-paper-hush transition-colors hover:text-on-paper sm:block">
            Log in
          </a>
          <a
            href="/signup"
            className="rounded-[7px] bg-on-paper px-4 py-2.5 text-[14px] text-white transition-colors duration-150 ease-[var(--ease-ui)] hover:bg-signal-deep"
          >
            Start a workspace
          </a>
          <button
            onClick={() => setMobile((v) => !v)}
            aria-expanded={mobile}
            aria-label="Menu"
            className="rounded-[6px] border border-line-light px-3 py-2 font-mono text-[11px] lg:hidden"
          >
            {mobile ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {/* dropdown */}
      {open ? (
        <div
          className="absolute inset-x-0 top-[64px] hidden border-b border-line-light bg-white lg:block"
          style={{ boxShadow: "var(--shadow-card)", animation: "slideUpAndFade 200ms var(--ease-ui) both" }}
          onMouseEnter={() => setOpen(open)}
        >
          <div className="mx-auto grid w-full max-w-[1440px] gap-1 px-6 py-6 md:grid-cols-2 md:px-10 lg:px-14">
            {MENUS[open].map((m) => (
              <a
                key={m.label}
                href={m.href}
                onClick={() => setOpen(null)}
                className="rounded-[8px] px-4 py-3 transition-colors duration-150 hover:bg-paper-cool"
              >
                <div className="text-[14.5px] font-medium">{m.label}</div>
                <div className="mt-0.5 text-[13px] text-on-paper-hush">{m.note}</div>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {/* mobile drawer */}
      {mobile ? (
        <div className="border-t border-line-light bg-white px-6 py-4 lg:hidden">
          {Object.entries(MENUS).map(([k, items]) => (
            <div key={k} className="mb-4">
              <div className="font-mono text-[10px] tracking-[0.14em] text-on-paper-hush uppercase">
                {k}
              </div>
              <div className="mt-2 flex flex-col">
                {items.map((m) => (
                  <a key={m.label} href={m.href} onClick={() => setMobile(false)} className="py-2 text-[15px]">
                    {m.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
          <a href="#pricing" className="block py-2 text-[15px]">Pricing</a>
          <a href="/login" className="block py-2 text-[15px]">Log in</a>
          <a href="/signup" className="block py-2 text-[15px]">Start a workspace</a>
        </div>
      ) : null}
    </header>
  );
}
