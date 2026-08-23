import { paise, type Paise } from "@finco/core";

/**
 * 14-day forward cash position.
 *
 * p10 is the line that matters — a cash forecast is read for the downside, so
 * it is drawn heaviest. The floor is a figure the CFO sets once.
 *
 * Values are paise. The chart converts to Number only to compute SVG
 * coordinates; no money arithmetic happens on the client.
 */
export type CashPoint = { day: number; p10: Paise; p50: Paise; p90: Paise };

const p = (rupees: number) => paise(BigInt(Math.round(rupees * 100)));

export const FLOOR = p(2_000_000);

export const CURVE: CashPoint[] = [
  { day: 0, p10: p(3_814_421), p50: p(3_814_421), p90: p(3_814_421) },
  { day: 1, p10: p(3_610_000), p50: p(3_742_000), p90: p(3_820_000) },
  { day: 2, p10: p(3_380_000), p50: p(3_598_000), p90: p(3_770_000) },
  { day: 3, p10: p(3_020_000), p50: p(3_310_000), p90: p(3_560_000) },
  { day: 4, p10: p(2_740_000), p50: p(3_120_000), p90: p(3_430_000) },
  { day: 5, p10: p(2_480_000), p50: p(2_960_000), p90: p(3_350_000) },
  { day: 6, p10: p(2_260_000), p50: p(2_880_000), p90: p(3_380_000) },
  { day: 7, p10: p(2_090_000), p50: p(2_820_000), p90: p(3_410_000) },
  { day: 8, p10: p(1_940_000), p50: p(2_760_000), p90: p(3_470_000) },
  { day: 9, p10: p(1_820_000), p50: p(2_740_000), p90: p(3_560_000) },
  { day: 10, p10: p(1_880_000), p50: p(2_860_000), p90: p(3_720_000) },
  { day: 11, p10: p(2_010_000), p50: p(3_020_000), p90: p(3_910_000) },
  { day: 12, p10: p(2_190_000), p50: p(3_240_000), p90: p(4_140_000) },
  { day: 13, p10: p(2_360_000), p50: p(3_430_000), p90: p(4_360_000) },
  { day: 14, p10: p(2_540_000), p50: p(3_620_000), p90: p(4_580_000) },
];

/** First day the p10 line sits below the floor. */
export const BREACH_DAY = 8;

export type Bucket = {
  bucket: string;
  source: string;
  value: Paise;
  oldest: string;
  emphasis: boolean;
};

export const AGEING: Bucket[] = [
  { bucket: "In settlement pipeline", source: "captured, T+2 not elapsed", value: paise(184211000n), oldest: "1 d", emphasis: false },
  { bucket: "On hold", source: "on_hold = true", value: paise(20450000n), oldest: "9 d", emphasis: false },
  { bucket: "Under dispute", source: "dispute_id open", value: paise(6422000n), oldest: "14 d", emphasis: false },
  { bucket: "Unproven", source: "open exceptions, suspense 9999", value: paise(24188000n), oldest: "6 d", emphasis: true },
];

/** Grounded strictly in the provenance graph. The refusal is a correct answer. */
export const ASKS = [
  {
    q: "Why was 11 June short by ₹4,120?",
    a: "A refund of ₹4,120 processed on 9 June was netted into the 11 June settlement. It belongs to the prior period.",
    rows: ["rfnd_Kx8812 · debit 4,120.00", "pay_DEXrni · settled 09 Jun", "setl_DGlQ1R · 11 Jun"],
    grounded: true,
  },
  {
    q: "Which settlements are still on hold?",
    a: "Two, totalling ₹2,04,500. The oldest has been held 9 days.",
    rows: ["setl_Nq4410 · on_hold · 1,42,300.00", "setl_Nq4471 · on_hold · 62,200.00"],
    grounded: true,
  },
  {
    q: "What did we pay Razorpay in fees last month?",
    a: "₹7,23,040 in gateway fees, with ₹1,30,147 of GST on those fees claimable as input credit.",
    rows: ["5210 gateway fees · 7,23,040.00", "1410 GST input credit · 1,30,147.00"],
    grounded: true,
  },
  {
    q: "What will we settle in April next year?",
    a: "I cannot prove that from this run. It would need April settlement data, which is not loaded.",
    rows: [],
    grounded: false,
  },
];

export const SOURCES = [
  "Razorpay",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra",
  "Tally",
  "Zoho Books",
  "NetSuite",
];
