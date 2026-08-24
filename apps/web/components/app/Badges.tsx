import { formatINR, paise } from "@finco/core";

/**
 * Colour is semantic here, never decorative (spec §4):
 *   green  proven, closes to zero
 *   slate  deterministic arithmetic
 *   clay   model-generated
 *   amber  refused or escalated
 */

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className="inline-block border border-line-light px-1.5 py-[1px] font-mono text-[10px] font-semibold tracking-[0.08em] text-ink-hush">
      {tier}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const tone =
    verdict === "PROVEN"
      ? "border-signal-deep text-signal-deep"
      : verdict === "ESCALATED"
        ? "border-refused text-refused"
        : "border-proposed text-proposed";
  return (
    <span
      className={`inline-block border px-1.5 py-[1px] font-mono text-[10px] font-semibold tracking-[0.08em] ${tone}`}
    >
      {verdict}
    </span>
  );
}

/**
 * A delta of zero is the product. It is rendered as an emphatic 0.00 rather
 * than a blank or a dash, because "nothing shown" and "proved to be nothing"
 * are different claims and only one of them is worth paying for.
 */
export function DeltaChip({ deltaPaise }: { deltaPaise: string }) {
  const v = BigInt(deltaPaise);
  if (v === 0n) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[12px] tnum text-signal-deep">
        <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full bg-signal" />
        0.00
      </span>
    );
  }
  return (
    <span className="font-mono text-[12px] tnum text-refused">
      {v > 0n ? "+" : "−"}
      {formatINR(paise(v < 0n ? -v : v))}
    </span>
  );
}
