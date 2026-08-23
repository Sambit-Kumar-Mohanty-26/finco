/**
 * Runnable self-check for the money primitives.
 *   pnpm --filter @finco/web check:money
 *
 * No framework on purpose. If formatting or the spoken label breaks, this
 * exits non-zero and says which case failed.
 */
import assert from "node:assert/strict";
import { formatINR, paise, serialisePaise, spokenINR } from "./money.ts";

// Indian grouping, not thousands grouping. This is the one that regresses.
assert.equal(formatINR(paise(49344665n)), "4,93,446.65");
assert.equal(formatINR(paise(24188000n)), "2,41,880.00");
assert.equal(formatINR(paise(38144210n)), "3,81,442.10");
assert.equal(formatINR(paise(11200455n)), "1,12,004.55");

// Zero renders as 0.00, never blank — blank means missing data in a ledger.
assert.equal(formatINR(paise(0n)), "0.00");
assert.equal(formatINR(paise(5n)), "0.05");
assert.equal(formatINR(paise(-100n)), "-1.00");

// Crore boundary: grouping changes shape at 10^7 paise = 1,00,000.00 rupees.
assert.equal(formatINR(paise(1000000000n)), "1,00,00,000.00");

// Above 2^53 paise the value must survive intact — the reason money is bigint.
assert.equal(formatINR(paise("900719925474099100")), "9,00,71,99,25,47,40,991.00");

// Wire format is a decimal string; JSON.stringify would throw on the bigint.
assert.equal(serialisePaise(paise(49344665n)), "49344665");
assert.equal(JSON.stringify({ amount: serialisePaise(paise(97100n)) }), '{"amount":"97100"}');

// Spoken labels use Indian scale words, not digit soup.
assert.equal(spokenINR(paise(24188000n)), "two lakh forty-one thousand eight hundred eighty rupees");
assert.equal(spokenINR(paise(49344665n)), "four lakh ninety-three thousand four hundred forty-six rupees sixty-five paise");
assert.equal(spokenINR(paise(0n)), "zero rupees");
assert.equal(spokenINR(paise(100n)), "one rupees");
assert.equal(spokenINR(paise(-250n)), "minus two rupees fifty paise");
assert.equal(spokenINR(paise(1000000000n)), "one crore rupees");

console.log("money: all checks passed");
