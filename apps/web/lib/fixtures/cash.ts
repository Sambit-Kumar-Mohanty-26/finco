import { paise, type Paise } from "@finco/core";

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
