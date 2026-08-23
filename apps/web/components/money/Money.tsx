import { formatINR, spokenINR, type Paise } from "@finco/core";

type Tone = "inherit" | "hush" | "signal" | "proven" | "proposed" | "refused";

const toneClass: Record<Tone, string> = {
  inherit: "",
  hush: "opacity-60",
  signal: "text-signal",
  proven: "text-proven",
  proposed: "text-proposed",
  refused: "text-refused",
};

/**
 * Integer paise only. No variant accepts rupees, a float, or a formatted
 * string — conversion happens once, in @finco/core.
 *
 * Defaults to `inherit` so a figure takes the colour of whichever band it sits
 * in. Semantic tones are for product surfaces only (spec §4).
 */
export function Money({
  paise,
  tone = "inherit",
  className = "",
}: {
  paise: Paise;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`font-mono tnum ${toneClass[tone]} ${className}`}
      aria-label={spokenINR(paise)}
    >
      <span aria-hidden="true">{formatINR(paise)}</span>
    </span>
  );
}
