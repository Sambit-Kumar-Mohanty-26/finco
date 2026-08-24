/**
 * UTR extraction from bank narrations.
 *
 * Four banks, four formats, all of them truncated and uppercased somewhere in
 * the pipeline. This is deliberately a deterministic parser and not a model
 * call: extracting a known-shape token is a regex problem, and T4 exists for
 * the narrations these rules genuinely cannot read.
 *
 * A UTR is 12–22 alphanumerics. NEFT UTRs are 16 characters beginning with the
 * originating bank's IFSC prefix (KKBK, HDFC, ICIC, UTIB); RTGS and IMPS
 * differ. We accept a superset and let the identity check reject a wrong one —
 * a bad UTR fails I2 by a rupee amount, which is a much clearer signal than a
 * parser that silently declines to match.
 */

export type Narration = {
  utr: string | null;
  /** Which rule fired. Surfaced in evidence so a wrong match is explainable. */
  format: "HDFC" | "ICICI" | "AXIS" | "KOTAK" | "BARE" | "NONE";
};

const RULES: { format: Narration["format"]; re: RegExp }[] = [
  // HDFC: "NEFT CR-KKBKH1415123456-RAZORPAY SOFTWARE PVT-***"
  { format: "HDFC", re: /(?:NEFT|RTGS|IMPS)\s*(?:CR|DR)?[-\s]([A-Z0-9]{12,22})/i },
  // ICICI: "MMT/IMPS/612345678901/RAZORPAY/HDFC"
  { format: "ICICI", re: /(?:MMT|MMTS)\/(?:IMPS|NEFT|RTGS)\/([A-Z0-9]{12,22})\//i },
  // AXIS: "UTR:KKBKH1415123456 RAZORPAY SOFTWA"
  { format: "AXIS", re: /\bUTR[:\s]+([A-Z0-9]{12,22})\b/i },
  // KOTAK: "RAZORPAY SOFTWARE PRIVATE LIMI-KKBKH1415123456"
  { format: "KOTAK", re: /RAZORPAY[A-Z\s]*[-/]([A-Z0-9]{12,22})\b/i },
  // Last resort: a bare token of UTR shape with no surrounding grammar.
  { format: "BARE", re: /\b([A-Z]{4}[A-Z0-9]{8,18})\b/ },
];

export function parseNarration(narration: string): Narration {
  const s = narration.toUpperCase();
  for (const { format, re } of RULES) {
    const m = s.match(re);
    if (m?.[1]) return { utr: m[1].toUpperCase(), format };
  }
  return { utr: null, format: "NONE" };
}
