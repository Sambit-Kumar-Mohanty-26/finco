/**
 * Banking-day arithmetic for the T2 settlement window.
 *
 * Razorpay settles T+2 *banking* days, so a match window measured in calendar
 * days drifts across every weekend and holiday and silently fails to match
 * legitimate rows — which then surface as exceptions the engine invented.
 *
 * Dates are handled as YYYY-MM-DD strings, never Date objects: a Date is a
 * timestamp, and this codebase runs in UTC on Render while the business day is
 * IST. Parsing "2026-06-11" as a Date and formatting it back can move it a day.
 */

/** RBI-observed bank holidays. Weekends are handled separately. */
const HOLIDAYS_2026 = new Set([
  "2026-01-01", // New Year (many states)
  "2026-01-26", // Republic Day
  "2026-03-03", // Holi
  "2026-03-21", // Id-ul-Fitr
  "2026-04-01", // Bank annual closing
  "2026-04-14", // Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-05-27", // Bakrid
  "2026-08-15", // Independence Day
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-08", // Diwali
  "2026-12-25", // Christmas
]);

const DAY_MS = 86_400_000;

function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isBankingDay(iso: string): boolean {
  const dow = new Date(toUTC(iso)).getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS_2026.has(iso);
}

/** The nth banking day on or after `iso`. `addBankingDays(d, 0)` normalises d. */
export function addBankingDays(iso: string, n: number): string {
  let ms = toUTC(iso);
  while (!isBankingDay(toISO(ms))) ms += DAY_MS;
  for (let i = 0; i < n; i++) {
    do ms += DAY_MS;
    while (!isBankingDay(toISO(ms)));
  }
  return toISO(ms);
}

/**
 * Every banking day in [from, from+n], inclusive — the candidate value dates a
 * settlement may legitimately land on.
 */
export function bankingWindow(iso: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= n; i++) out.push(addBankingDays(iso, i));
  return [...new Set(out)];
}

/** Banking days between two dates, `to` exclusive. Negative if `to` precedes. */
export function bankingDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const back = to < from;
  const [a, b] = back ? [to, from] : [from, to];
  let ms = toUTC(a);
  const end = toUTC(b);
  let n = 0;
  while (ms < end) {
    ms += DAY_MS;
    if (isBankingDay(toISO(ms))) n++;
  }
  return back ? -n : n;
}
