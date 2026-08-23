/**
 * The ONLY money file in apps/web.
 *
 * Money is bigint paise everywhere. JavaScript's number loses integer precision
 * above 2^53 and the failure is silent, so no money value is ever a `number`.
 * There is deliberately no helper that accepts rupees, and no arithmetic on
 * Paise anywhere in the client — every total arrives computed from the server.
 */

export type Paise = bigint & { readonly __brand: "paise" };

/** The one conversion point. Accepts the wire format (decimal string) or a bigint. */
export function paise(v: string | bigint): Paise {
  const n = typeof v === "string" ? BigInt(v) : v;
  return n as Paise;
}

/** Wire format is a decimal string — JSON.stringify throws on BigInt. */
export const serialisePaise = (p: Paise): string => p.toString();

/**
 * Display only. Indian digit grouping: 2,41,880.00 — never 241,880.00.
 * Never feeds back into arithmetic.
 */
export function formatINR(p: Paise): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rupees = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  const grouped = new Intl.NumberFormat("en-IN").format(rupees);
  return `${neg ? "-" : ""}${grouped}.${fraction}`;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety",
];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o === 0 ? t : `${t}-${ONES[o]}`;
}

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return under100(r);
  return r === 0 ? `${ONES[h]} hundred` : `${ONES[h]} hundred ${under100(r)}`;
}

/** Indian scale: crore (10^7), lakh (10^5), thousand, hundred. */
function words(n: bigint): string {
  if (n === 0n) return "zero";
  const parts: string[] = [];
  const crore = n / 10_000_000n;
  const afterCrore = n % 10_000_000n;
  const lakh = afterCrore / 100_000n;
  const afterLakh = afterCrore % 100_000n;
  const thousand = afterLakh / 1_000n;
  const rest = afterLakh % 1_000n;

  // Crores above 99 read as "one thousand crore", so recurse on that segment.
  if (crore > 0n) parts.push(`${words(crore)} crore`);
  if (lakh > 0n) parts.push(`${under100(Number(lakh))} lakh`);
  if (thousand > 0n) parts.push(`${under100(Number(thousand))} thousand`);
  if (rest > 0n) parts.push(under1000(Number(rest)));
  return parts.join(" ");
}

/**
 * Screen-reader label. "2,41,880.00" must announce as
 * "two lakh forty-one thousand eight hundred eighty rupees", not as digit soup.
 */
export function spokenINR(p: Paise): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rupees = abs / 100n;
  const fraction = abs % 100n;
  const head = `${words(rupees)} rupees`;
  const tail = fraction > 0n ? ` ${words(fraction)} paise` : "";
  return `${neg ? "minus " : ""}${head}${tail}`;
}
