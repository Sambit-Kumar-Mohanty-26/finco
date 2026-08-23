import { SiteNav } from "@/components/site/SiteNav";
import { Footer } from "@/components/site/Footer";
import {
  CashScreen,
  LedgerScreen,
  QueueScreen,
  RefusalScreen,
  RunScreen,
} from "@/components/app/Screens";
import { Money } from "@/components/money/Money";
import { RUN } from "@/lib/fixtures/run.ts";
import { EXCEPTIONS_TOTAL } from "@/lib/fixtures/ledger.ts";
import { limitations } from "@/lib/fixtures/landing.ts";
import { FilmGrain, Tilt, Words } from "@/components/site/Motion";
import { Reveal } from "@/components/site/Reveal";
import { HeroScene } from "@/components/hero/HeroScene";

/**
 * Product marketing site — Mercury structure, our content.
 *
 * The job here is credibility, not invention: a real navigation, the actual
 * product shown large and repeatedly, real depth, and the boring furniture
 * (metrics, security, pricing, a dense footer) that signals a company exists.
 */

function Wrap({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[1440px] px-6 md:px-10 lg:px-14 ${className}`}>{children}</div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
      {children}
    </span>
  );
}

const CAPABILITIES = [
  {
    k: "Reconciliation",
    d: "Razorpay recon rows, your bank statement and your ERP invoices, matched to a per-settlement identity that closes to zero paise.",
  },
  {
    k: "Exceptions",
    d: "Everything unproven becomes a typed, evidenced work item with an owner, an age and a playbook. Fourteen classes, not one bucket.",
  },
  {
    k: "Ledger & close",
    d: "A balanced double-entry journal, a trial balance that ties, and a period lock that refuses to close over an open suspense balance.",
  },
  {
    k: "Cash position",
    d: "Fourteen days forward, with unproven money shown as a line item beside on-hold and disputed cash.",
  },
];

export default function Page() {
  return (
    <>
      <SiteNav />

      <main id="top">
        <HeroScene />

        {/* ------------------------------------------ capability map */}
        <section id="how" className="border-t border-line-light py-20 md:py-28">
          <Wrap>
            <div className="max-w-[46ch]">
              <Eyebrow>The whole close</Eyebrow>
              <h2 className="mt-5 font-display text-[clamp(32px,4vw,52px)] leading-[1.06] font-normal tracking-[-0.02em]">
                <Words>Everything in your close. One system.</Words>
              </h2>
            </div>
            <Reveal stagger className="mt-14 grid gap-px overflow-hidden rounded-[14px] border border-line-light bg-line-light md:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((c, i) => (
                <div key={c.k} className="bg-white px-6 py-7">
                  <div className="font-mono text-[10px] tracking-[0.14em] text-on-paper-hush">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="mt-3 text-[17px] font-medium">{c.k}</h3>
                  <p className="mt-2 text-[14px] leading-[1.55] text-on-paper-hush">{c.d}</p>
                </div>
              ))}
            </Reveal>
          </Wrap>
        </section>

        {/* ------------------------------------------ reconciliation */}
        <Feature
          id="reconciliation"
          eyebrow="Reconciliation"
          title="Deterministic first. The model only sees what survives."
          body="Four exact-arithmetic passes take 84 percent of a 5,000-row batch in seconds. The model runs last, on the residual, and everything it proposes is forced back through a verifier that recomputes the arithmetic before anything posts."
          points={[
            "Exact key, identity close, banking-day window, bounded subset-sum",
            "Ambiguous subsets are refused, not guessed",
            "Byte-identical replay on the same inputs",
          ]}
          screen={<LedgerScreen />}
        />

        {/* ------------------------------------------------ refusal */}
        <section id="exceptions" className="border-t border-line-light bg-paper-cool py-20 md:py-28">
          <Wrap>
            <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-20">
              <div className="min-w-0">
                <Eyebrow>The refusal</Eyebrow>
                <h2 className="mt-5 font-display text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-normal tracking-[-0.02em]">
                  Adding up is not the same as being the only thing that adds up.
                </h2>
                <p className="mt-5 text-[17px] leading-[1.6] text-on-paper-hush">
                  Two combinations of settlements hit this bank credit exactly.
                  Most tools take the first one that fits and report a higher
                  match rate. FinCo counts the solutions, finds two, and escalates
                  instead of guessing.
                </p>
                <p className="mt-4 text-[17px] leading-[1.6] text-on-paper-hush">
                  It costs two to three points of auto-match. It buys a precision
                  of 1.000.
                </p>
              </div>
              <div className="min-w-0">
                <Reveal variant="frame" from="right">
                  <Tilt className="rounded-[14px]">
                    <RefusalScreen />
                  </Tilt>
                </Reveal>
              </div>
            </div>
          </Wrap>
        </section>

        {/* ------------------------------------------------- queue */}
        <Feature
          id="ledger"
          eyebrow="Exception queue"
          title="An honest exception list, in rupees."
          body="Unmatched rows are not a number, they are work. Every exception is typed into one of fourteen classes, carries its evidence and its owner, ages visibly, and parks its value in a suspense account that has to reach zero before the period can lock."
          points={[
            "Bulk approve within a class, never across classes",
            "Approving and escalating cost the same keystroke",
            "Suspense ages by day and blocks the close",
          ]}
          screen={<QueueScreen />}
          reverse
        />

        {/* ------------------------------------------------ metrics */}
        <section className="border-t border-line-light bg-on-paper py-20 text-white md:py-28">
          <Wrap>
            <div className="max-w-[46ch]">
              <Eyebrow>
                <span className="text-signal">Measured accuracy</span>
              </Eyebrow>
              <h2 className="mt-5 font-display text-[clamp(30px,3.6vw,48px)] leading-[1.06] font-normal tracking-[-0.02em]">
                Measured against an answer key, not asserted.
              </h2>
            </div>
            <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/10 bg-white/10 md:grid-cols-4">
              {[
                { l: "auto-match rate", v: RUN.autoMatch },
                { l: "precision", v: RUN.precision, signal: true },
                { l: "false matches", v: "0", signal: true },
                { l: "unproven", node: <Money paise={EXCEPTIONS_TOTAL.value} className="text-[clamp(20px,2vw,26px)]" /> },
              ].map((s) => (
                <div key={s.l} className="bg-on-paper px-6 py-8">
                  <div
                    className={`font-mono text-[clamp(24px,2.6vw,34px)] tnum tracking-[-0.02em] ${
                      s.signal ? "text-signal" : ""
                    }`}
                  >
                    {s.node ?? s.v}
                  </div>
                  <div className="mt-2 font-mono text-[9.5px] tracking-[0.13em] text-white/45 uppercase">
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-8 max-w-[64ch] text-[16px] leading-[1.6] text-white/60">
              The model proposed {RUN.proposalsMade} links. We accepted{" "}
              {RUN.proposalsAccepted}. We rejected {RUN.proposalsRejected}, and
              every rejection carries the arithmetic reason it failed. Where the
              model was wrong is a headline metric here, not a hidden one.
            </p>
          </Wrap>
        </section>

        {/* --------------------------------------------------- cash */}
        <Feature
          id="cash"
          eyebrow="Cash position"
          title="Unproven money is a line on the cash position."
          body="Settlement timing is a calendar function, not a prediction: capture date, T+2, the RBI holiday list. Only refund and dispute drag is uncertain, so it is shown as a band rather than a point."
          points={[
            "Fourteen-day forward curve, p10 drawn heaviest",
            "In pipeline, on hold, disputed and unproven, aged",
            "An unresolved match is cash you cannot count on yet",
          ]}
          screen={<CashScreen />}
        />

        {/* ----------------------------------------------- security */}
        <section id="security" className="border-t border-line-light py-20 md:py-28">
          <Wrap>
            <div className="grid gap-14 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-20">
              <div className="min-w-0">
                <Eyebrow>Security & controls</Eyebrow>
                <h2 className="mt-5 font-display text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-normal tracking-[-0.02em]">
                  Built to survive an audit.
                </h2>
                <p className="mt-5 text-[17px] leading-[1.6] text-on-paper-hush">
                  This is a book of account for an Indian entity. The constraints
                  are cheap designed in and expensive retrofitted, so they are in
                  from the start.
                </p>
              </div>
              <Reveal stagger from="right" className="grid gap-px overflow-hidden rounded-[14px] border border-line-light bg-line-light sm:grid-cols-2">
                {[
                  ["Data residency", "All compute and storage in ap-south-1. Payment records are not replicated cross-region."],
                  ["PCI scope", "Card numbers never enter the system. Network, issuer, type and last four only."],
                  ["Append-only ledger", "Hash-chained entries. Corrections are reversing entries, never edits."],
                  ["Segregation of duties", "The agent proposes. A human with an approver role accepts. Auto-post is a separate permission."],
                  ["Retention", "Eight years per the Companies Act, with object-lock on raw source files."],
                  ["Model provenance", "Model-touched entries carry the prompt hash and model version, and are queryable as a class."],
                ].map(([t, d]) => (
                  <div key={t} className="bg-white px-6 py-6">
                    <h3 className="text-[15.5px] font-medium">{t}</h3>
                    <p className="mt-2 text-[13.5px] leading-[1.55] text-on-paper-hush">{d}</p>
                  </div>
                ))}
              </Reveal>
            </div>
          </Wrap>
        </section>

        {/* -------------------------------------------- limitations */}
        <section id="limits" className="border-t border-line-light bg-paper-cool py-20 md:py-28">
          <Wrap>
            <div className="max-w-[46ch]">
              <Eyebrow>Honest limitations</Eyebrow>
              <h2 className="mt-5 font-display text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-normal tracking-[-0.02em]">
                What it does not do yet.
              </h2>
            </div>
            <Reveal as="ul" stagger className="mt-12 grid list-none gap-px overflow-hidden rounded-[14px] border border-line-light bg-line-light p-0 md:grid-cols-2">
              {limitations.map((l, i) => (
                <li key={i} className="bg-white px-6 py-6">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-on-paper-hush">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-2.5 text-[14.5px] leading-[1.6] text-on-paper-hush">{l}</p>
                </li>
              ))}
            </Reveal>
          </Wrap>
        </section>

        {/* --------------------------------------------------- CTA */}
        <section id="start" className="border-t border-line-light py-24 md:py-32">
          <Wrap>
            <div className="mx-auto max-w-[720px] text-center">
              <h2 className="font-display text-[clamp(32px,4.4vw,58px)] leading-[1.04] font-normal tracking-[-0.025em]">
                <Words>Bring one month. We will close it.</Words>
              </h2>
              <p className="mx-auto mt-5 max-w-[52ch] text-[18px] leading-[1.55] text-on-paper-hush">
                Send a period of Razorpay recon rows, a bank statement and your
                invoice register. You get back a balanced journal, a scorecard and
                an honest list of everything we could not prove.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="#contact"
                  className="lift rounded-[8px] bg-on-paper px-6 py-3.5 text-[15px] text-white hover:bg-signal-deep"
                >
                  Book a close review
                </a>
                <a
                  href="#limits"
                  className="lift rounded-[8px] border border-line-light bg-white px-6 py-3.5 text-[15px] hover:border-on-paper/25"
                >
                  Read the limitations first
                </a>
              </div>
            </div>
          </Wrap>
        </section>
      </main>

      <Footer />
      <FilmGrain />
    </>
  );
}

function Feature({
  id,
  eyebrow,
  title,
  body,
  points,
  screen,
  reverse = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  screen: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section id={id} className="border-t border-line-light py-20 md:py-28">
      <Wrap>
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
          <Reveal className={`min-w-0 ${reverse ? "lg:order-2" : ""}`} from={reverse ? "right" : "left"}>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="mt-5 font-display text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-normal tracking-[-0.02em]">
              {title}
            </h2>
            <p className="mt-5 text-[17px] leading-[1.6] text-on-paper-hush">{body}</p>
            <ul className="mt-7 flex list-none flex-col gap-3 p-0">
              {points.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-[1.5]">
                  <span aria-hidden="true" className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-signal-deep" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <div className={`min-w-0 ${reverse ? "lg:order-1" : ""}`}>
            <Reveal variant="frame" from={reverse ? "left" : "right"}><Tilt className="rounded-[14px]">{screen}</Tilt></Reveal>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
