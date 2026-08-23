import type { ReactNode } from "react";

export type Band = "ink" | "paper" | "paper-cool";

const band: Record<Band, string> = {
  ink: "bg-ink text-on-ink",
  paper: "bg-paper text-on-paper",
  "paper-cool": "bg-paper-cool text-on-paper",
};

/** Max content width and gutters. One place, so the page never drifts. */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1160px] px-6 md:px-10 ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  tone,
  id,
  children,
  className = "",
}: {
  tone: Band;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-band={tone === "ink" ? "ink" : "paper"}
      className={`scroll-mt-20 py-24 md:py-36 ${band[tone]} ${className}`}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({
  children,
  tone = "paper",
}: {
  children: ReactNode;
  tone?: "ink" | "paper";
}) {
  return (
    <span
      className={`block font-mono text-[11px] font-semibold tracking-[0.18em] uppercase ${
        tone === "ink" ? "text-signal" : "text-on-paper-hush"
      }`}
    >
      {children}
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  tone = "paper",
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  tone?: "ink" | "paper";
}) {
  return (
    <div className="enter-stack max-w-[46ch]">
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className="mt-5 font-display text-[clamp(36px,4.5vw,60px)] leading-[1.06] font-normal tracking-[-0.02em]">
        {title}
      </h2>
      {lede ? (
        <p
          className={`mt-5 text-[20px] leading-[1.55] ${
            tone === "ink" ? "text-on-ink-hush" : "text-on-paper-hush"
          }`}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}
