import { Money } from "@/components/money/Money";
import { AGEING, BREACH_DAY, CURVE, FLOOR } from "@/lib/fixtures/cash.ts";

/**
 * C7 — the 14-day cash position.
 *
 * p10 is drawn heaviest because a cash forecast is read for the downside, and
 * the floor breach is stated in words above the chart as well as drawn. A
 * visual intersection alone is not a warning.
 *
 * Static SVG; the path draws in via the scroll-driven .enter on its wrapper.
 * bigint paise are converted to Number for coordinates only — geometry is not
 * accounting.
 */
const W = 720;
const H = 240;
const PAD = { t: 16, r: 8, b: 26, l: 8 };

const n = (p: bigint) => Number(p / 100n); // rupees, for coordinates only

const values = CURVE.flatMap((c) => [n(c.p10), n(c.p90)]).concat(n(FLOOR));
const min = Math.min(...values) * 0.92;
const max = Math.max(...values) * 1.04;

const x = (day: number) =>
  PAD.l + (day / (CURVE.length - 1)) * (W - PAD.l - PAD.r);
const y = (v: number) =>
  PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

const line = (key: "p10" | "p50" | "p90") =>
  CURVE.map((c, i) => `${i === 0 ? "M" : "L"}${x(c.day)} ${y(n(c[key]))}`).join(" ");

const band = [
  ...CURVE.map((c, i) => `${i === 0 ? "M" : "L"}${x(c.day)} ${y(n(c.p90))}`),
  ...[...CURVE].reverse().map((c) => `L${x(c.day)} ${y(n(c.p10))}`),
  "Z",
].join(" ");

export function CashCurve({ dark = false }: { dark?: boolean }) {
  const card = dark ? "border-white/10 bg-black/35 backdrop-blur-sm" : "border-line-light bg-white";
  const rule = dark ? "border-white/8" : "border-line-light";
  const hush = dark ? "text-white/45" : "text-on-paper-hush";
  const ink = dark ? "text-on-ink" : "text-on-paper";
  const axis = dark ? "fill-white/45" : "fill-on-paper-hush";
  const p10 = dark ? "var(--color-signal)" : "var(--color-signal-deep)";
  return (
    <div className="enter">
      <p className={`max-w-[54ch] text-[19px] leading-[1.5] ${ink}`}>
        On the p10 line, cash crosses the floor on{" "}
        <span className="text-refused">day {BREACH_DAY}</span> and stays under it
        for three days.
      </p>

      <div className={`mt-8 scroll-x rounded-[12px] border ${card} p-5`}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`Fourteen day cash forecast. The p10 line falls below the floor on day ${BREACH_DAY} and recovers by day 11.`}
        >
          <path d={band} fill="var(--color-signal)" opacity="0.10" />

          {/* floor */}
          <line
            x1={x(0)}
            y1={y(n(FLOOR))}
            x2={x(14)}
            y2={y(n(FLOOR))}
            stroke="var(--color-refused)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text
            x={x(0)}
            y={y(n(FLOOR)) - 7}
            className="fill-refused font-mono"
            fontSize="9"
            letterSpacing="0.1em"
          >
            FLOOR
          </text>

          <path d={line("p90")} fill="none" stroke="var(--color-signal)" strokeWidth="1" opacity="0.45" />
          <path d={line("p50")} fill="none" stroke="var(--color-signal)" strokeWidth="1.4" opacity="0.7" />
          <path d={line("p10")} fill="none" stroke={p10} strokeWidth="2.6" />

          {[0, 4, 8, 11, 14].map((d) => (
            <text
              key={d}
              x={x(d)}
              y={H - 8}
              textAnchor={d === 0 ? "start" : d === 14 ? "end" : "middle"}
              className={`${axis} font-mono`}
              fontSize="9.5"
            >
              day {d}
            </text>
          ))}
        </svg>

        <div className={`mt-4 flex flex-wrap items-center gap-5 border-t ${rule} pt-4 font-mono text-[10px] ${hush}`}>
          <Key w="2.6" o="1" c={p10} label="p10 — plan against this" />
          <Key w="1.4" o="0.7" c="var(--color-signal)" label="p50" />
          <Key w="1" o="0.45" c="var(--color-signal)" label="p90" />
        </div>
      </div>

      <div className={`mt-8 scroll-x rounded-[12px] border ${card}`}>
        <table className="w-full min-w-[520px] border-collapse text-[13.5px]">
          <caption className="sr-only">
            Cash at risk: money that has left the customer but not arrived in the bank
          </caption>
          <thead>
            <tr>
              {["Bucket", "Source", "Value", "Oldest"].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`border-b ${rule} px-5 py-3 font-mono text-[9.5px] font-semibold tracking-[0.12em] ${hush} uppercase ${
                    i >= 2 ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AGEING.map((b) => (
              <tr key={b.bucket} className={b.emphasis ? "bg-refused/[0.06]" : undefined}>
                <th
                  scope="row"
                  className={`border-b ${rule} px-5 py-3.5 text-left text-[14px] ${
                    b.emphasis ? "font-semibold text-refused" : `font-medium ${ink}`
                  }`}
                >
                  {b.bucket}
                </th>
                <td className={`border-b ${rule} px-5 py-3.5 font-mono text-[10.5px] ${hush}`}>
                  {b.source}
                </td>
                <td className={`border-b ${rule} px-5 py-3.5 text-right`}>
                  <Money paise={b.value} tone={b.emphasis ? "refused" : "inherit"} className="text-[12.5px]" />
                </td>
                <td className={`border-b ${rule} px-5 py-3.5 text-right font-mono text-[11.5px] ${hush}`}>
                  {b.oldest}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={`mt-8 max-w-[58ch] text-[18px] leading-[1.55] ${hush}`}>
        The last row is what joins the two halves of the product: an unresolved
        match is money you cannot count on yet.
      </p>
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
