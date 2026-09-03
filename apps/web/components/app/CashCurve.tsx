import { paiseOf, type ForecastPoint } from "@/lib/api";
import { Money } from "@/components/money/Money";

/**
 * The forward cash curve.
 *
 * p10 is drawn heaviest, because a cash forecast is read for the DOWNSIDE. The
 * optimistic line is the one nobody plans against, so giving it equal weight
 * invites the eye to average the band — and the average of "we might be fine"
 * and "we might not" is not a number anyone can act on.
 *
 * Hand-rolled SVG rather than a chart library: this is three polylines and a
 * dashed rule, and the alternative is 90 KB on the one route a CFO opens on a
 * phone. bigint paise become Number for COORDINATES ONLY — geometry is not
 * accounting, and no money arithmetic happens on the client.
 */

const W = 720;
const H = 220;
const PAD = { t: 14, r: 10, b: 24, l: 10 };

export function CashCurve({
  curve,
  floorPaise,
  breachDate,
}: {
  curve: ForecastPoint[];
  floorPaise: string;
  breachDate: string | null;
}) {
  if (curve.length < 2) {
    return (
      <p className="mt-6 font-mono text-[12px] text-ink-hush">
        Not enough forward days to draw a curve.
      </p>
    );
  }

  const r = (v: string) => Number(BigInt(v) / 100n); // rupees, for coordinates
  const floor = r(floorPaise);

  const values = curve.flatMap((c) => [r(c.cumP10Paise), r(c.cumP90Paise)]).concat(floor, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat curve would divide by zero. One rupee of span is enough to draw a
  // straight line through the middle rather than NaN coordinates.
  const span = Math.max(1, max - min);

  const x = (i: number) => PAD.l + (i / (curve.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);

  const line = (key: "cumP10Paise" | "cumP50Paise" | "cumP90Paise") =>
    curve.map((c, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(r(c[key]))}`).join(" ");

  const band = [
    ...curve.map((c, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(r(c.cumP90Paise))}`),
    ...[...curve].reverse().map((c, i) => `L${x(curve.length - 1 - i)} ${y(r(c.cumP10Paise))}`),
    "Z",
  ].join(" ");

  const ticks = [0, Math.floor((curve.length - 1) / 2), curve.length - 1];
  const day = (d: string) => d.slice(5).replace("-", "/");

  return (
    <div className="rounded-[12px] border border-line-light bg-white p-4 sm:p-5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={
          `Cumulative cash expected over ${curve.length} days. The cautious p10 line ` +
          (breachDate
            ? `stays below the floor until ${breachDate}.`
            : `clears the floor throughout.`)
        }
      >
        <path d={band} fill="var(--color-signal)" opacity="0.10" />

        <line
          x1={x(0)}
          y1={y(floor)}
          x2={x(curve.length - 1)}
          y2={y(floor)}
          stroke="var(--color-refused)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text
          x={x(0)}
          y={Math.max(10, y(floor) - 6)}
          className="fill-refused font-mono"
          fontSize="9"
          letterSpacing="0.1em"
        >
          FLOOR
        </text>

        <path d={line("cumP90Paise")} fill="none" stroke="var(--color-signal)" strokeWidth="1" opacity="0.45" />
        <path d={line("cumP50Paise")} fill="none" stroke="var(--color-signal)" strokeWidth="1.4" opacity="0.7" />
        <path d={line("cumP10Paise")} fill="none" stroke="var(--color-signal-deep)" strokeWidth="2.6" />

        {/* Weekends carry no settlement, so the curve goes flat. Marking them
            stops a flat stretch reading as a data outage. */}
        {curve.map((c, i) =>
          c.bankingDay ? null : (
            <circle key={c.date} cx={x(i)} cy={H - 18} r="1.6" className="fill-on-paper-hush" opacity="0.5" />
          ),
        )}

        {ticks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === curve.length - 1 ? "end" : "middle"}
            className="fill-on-paper-hush font-mono"
            fontSize="9.5"
          >
            {day(curve[i]!.date)}
          </text>
        ))}
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-light pt-3 font-mono text-[10px] text-ink-hush">
        <Key w="2.6" o="1" c="var(--color-signal-deep)" label="p10 — plan against this" />
        <Key w="1.4" o="0.7" c="var(--color-signal)" label="p50" />
        <Key w="1" o="0.45" c="var(--color-signal)" label="p90" />
        <span className="flex items-center gap-2">
          floor <Money paise={paiseOf(floorPaise)} className="text-[10px]" />
        </span>
      </div>
    </div>
  );
}

function Key({ w, o, c, label }: { w: string; o: string; c: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="8" aria-hidden="true">
        <line x1="0" y1="4" x2="22" y2="4" stroke={c} strokeWidth={w} opacity={o} />
      </svg>
      {label}
    </span>
  );
}
