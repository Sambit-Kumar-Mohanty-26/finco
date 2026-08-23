const COLUMNS: { title: string; links: string[] }[] = [
  {
    title: "Product",
    links: ["Reconciliation", "Exception queue", "Ledger & close", "Cash position", "Ask", "Integrations", "Changelog"],
  },
  {
    title: "Solutions",
    links: ["Marketplaces", "SaaS", "Ecommerce", "Agencies", "Route sellers", "Finance teams"],
  },
  {
    title: "Developers",
    links: ["Docs", "API reference", "Webhooks", "Razorpay setup", "Bank formats", "Status"],
  },
  {
    title: "Company",
    links: ["About", "Security", "Compliance", "Careers", "Contact", "Press"],
  },
  {
    title: "Legal",
    links: ["Terms", "Privacy", "Data residency", "DPA", "Sub-processors", "Responsible disclosure"],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line-light bg-paper-cool">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-16 md:px-10 md:py-20 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_3fr]">
          <div>
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" width={30} height={30} className="h-[30px] w-[30px]" />
              <span className="font-mono text-[14px] font-semibold tracking-[0.12em] uppercase">
                FinCo
              </span>
            </div>
            <p className="mt-4 max-w-[34ch] text-[14px] leading-[1.55] text-on-paper-hush">
              Reconciliation and close for Indian merchants on Razorpay. Every
              rupee proven, or named as unproven.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-[5px] border border-line-light bg-white px-2.5 py-1 font-mono text-[10px] text-on-paper-hush">
                ap-south-1
              </span>
              <span className="rounded-[5px] border border-line-light bg-white px-2.5 py-1 font-mono text-[10px] text-on-paper-hush">
                SAQ-A scope
              </span>
              <span className="rounded-[5px] border border-line-light bg-white px-2.5 py-1 font-mono text-[10px] text-on-paper-hush">
                8-year retention
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <div className="font-mono text-[10px] font-semibold tracking-[0.14em] text-on-paper-hush uppercase">
                  {c.title}
                </div>
                <ul className="mt-3 flex list-none flex-col gap-2 p-0">
                  {c.links.map((l) => (
                    <li key={l}>
                      <a
                        href="#"
                        className="text-[13.5px] text-on-paper-hush transition-colors duration-150 hover:text-on-paper"
                      >
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-line-light pt-8 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[10.5px] text-on-paper-hush">
            © 2026 FinCo Technologies Pvt Ltd · Bengaluru
          </p>
          <p className="max-w-[62ch] font-mono text-[10.5px] leading-relaxed text-on-paper-hush">
            Figures shown throughout come from a seeded synthetic scenario with a
            known answer key, not from a live merchant account.
          </p>
        </div>
      </div>
    </footer>
  );
}
