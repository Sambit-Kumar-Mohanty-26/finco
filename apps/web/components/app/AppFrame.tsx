import type { ReactNode } from "react";

/**
 * A window around real product UI.
 *
 * This is what makes the marketing page read as a real company shipping real
 * software: not a diagram *about* the product, but the product itself, in
 * chrome, with weight. Every screen inside it renders the same components and
 * the same fixtures the app uses.
 */
const NAV = [
  { label: "Runs", key: "runs" },
  { label: "Exceptions", key: "exceptions" },
  { label: "Ledger", key: "ledger" },
  { label: "Cash", key: "cash" },
  { label: "Ask", key: "ask" },
];

export function AppFrame({
  active,
  title,
  meta,
  children,
  className = "",
  chromeVar = false,
}: {
  active: string;
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
  /**
   * When true, the BROWSER chrome (traffic lights, URL bar, rounded corners,
   * shadow) is driven by the `--chrome` custom property: 1 = framed window,
   * 0 = the application fullscreen. The sidebar deliberately stays — a real
   * app at fullscreen still has its navigation; it is the browser that goes.
   * Off by default, so every other call site is untouched.
   */
  chromeVar?: boolean;
}) {
  return (
    <div
      className={`min-w-0 overflow-hidden bg-white ${
        chromeVar ? "app-frame-var" : "rounded-[14px] border border-line-light"
      } ${className}`}
      style={chromeVar ? undefined : { boxShadow: "var(--shadow-frame)" }}
    >
      {/* title bar */}
      <div
        className={`flex items-center gap-3 border-b border-line-light bg-paper-cool px-4 py-2.5 ${
          chromeVar ? "app-frame-bar" : ""
        }`}
      >
        <div className="flex gap-[6px]" aria-hidden="true">
          <span className="h-[9px] w-[9px] rounded-full bg-on-paper/12" />
          <span className="h-[9px] w-[9px] rounded-full bg-on-paper/12" />
          <span className="h-[9px] w-[9px] rounded-full bg-on-paper/12" />
        </div>
        <div className="mx-auto flex items-center gap-2 rounded-[5px] border border-line-light bg-white px-3 py-1">
          <span className="h-[7px] w-[7px] rounded-full bg-signal-deep" aria-hidden="true" />
          <span className="font-mono text-[10.5px] text-on-paper-hush">
            app.finco.in/{active}
          </span>
        </div>
      </div>

      <div className="flex min-h-[380px] min-w-0">
        {/* sidebar */}
        <aside className="hidden w-[168px] shrink-0 border-r border-line-light bg-paper-cool/60 p-3 sm:block">
          <div className="flex items-center gap-2 px-2 pt-1 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" width={16} height={16} className="h-4 w-4" />
            <span className="font-mono text-[11px] font-semibold tracking-[0.14em] uppercase">
              FinCo
            </span>
          </div>
          <nav className="flex flex-col gap-[2px]">
            {NAV.map((n) => (
              <span
                key={n.key}
                aria-current={n.key === active ? "page" : undefined}
                className={`rounded-[5px] px-2 py-[6px] text-[12.5px] ${
                  n.key === active
                    ? "bg-white text-on-paper shadow-[0_1px_2px_rgba(20,22,26,0.06)]"
                    : "text-on-paper-hush"
                }`}
              >
                {n.label}
              </span>
            ))}
          </nav>
          <div className="mt-5 border-t border-line-light px-2 pt-4">
            <div className="font-mono text-[9px] tracking-[0.12em] text-on-paper-hush uppercase">
              period
            </div>
            <div className="mt-1 font-mono text-[11.5px]">2026-06</div>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-signal-wash px-2 py-[3px]">
              <span className="h-[5px] w-[5px] rounded-full bg-signal-deep" />
              <span className="font-mono text-[9.5px] text-signal-deep">open</span>
            </div>
          </div>
        </aside>

        {/* content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-light px-5 py-3.5">
            <h3 className="text-[15px] font-medium">{title}</h3>
            {meta ? (
              <span className="font-mono text-[11px] text-on-paper-hush">{meta}</span>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
