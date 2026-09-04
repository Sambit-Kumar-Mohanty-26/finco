import assert from "node:assert/strict";
import { detectMapping, parseCsv, periodOf, rupeesToPaise, toBundleRows, toIsoDate } from "./csv.ts";

/**
 * The CSV path, end to end, with no browser and no network.
 *
 * What is worth checking here is not "does it parse" — it is that money never
 * touches a float and that a column mapped wrong fails loudly instead of
 * quietly inventing a figure. Both are how a reconciliation silently stops
 * being one.
 */

/* --- the parser ---------------------------------------------------------- */

const quoted = parseCsv(
  'Settlement Id,Amount,Narration\r\nsetl_1,"1,234.56","NEFT ""ACME"", MUMBAI"\r\nsetl_2,10.00,plain\r\n\r\n',
);
assert.deepEqual(quoted.headers, ["Settlement Id", "Amount", "Narration"]);
assert.equal(quoted.rows.length, 2, "the trailing blank line is not a row");
assert.equal(quoted.rows[0]![1], "1,234.56", "a comma inside quotes is not a separator");
assert.equal(quoted.rows[0]![2], 'NEFT "ACME", MUMBAI', "a doubled quote is one literal quote");

// A quoted field may span lines. Excel produces this whenever a narration wraps.
assert.equal(parseCsv('a,b\n"one\ntwo",3\n').rows[0]![0], "one\ntwo");

// A BOM belongs to the file, not to the first header.
assert.deepEqual(parseCsv("﻿ref,amount\nx,1\n").headers, ["ref", "amount"]);

/* --- money: the whole reason this file exists ----------------------------- */

// The case that motivates the string surgery. parseFloat("1234.56") * 100 is
// 123455.99999999999; anything that rounds is one paise light on some inputs.
assert.equal(rupeesToPaise("1,234.56"), 123456n);
assert.equal(rupeesToPaise("₹ 2,41,880.00"), 24188000n, "Indian grouping and a symbol");
assert.equal(rupeesToPaise("0.05"), 5n);
assert.equal(rupeesToPaise("100"), 10000n, "no decimal point is whole rupees");
assert.equal(rupeesToPaise(".5"), 50n, "a bare fraction is fifty paise, not five");
assert.equal(rupeesToPaise(""), 0n, "an empty cell is zero, not a failure");
assert.equal(rupeesToPaise("-"), 0n, "a dash is how a bank writes 'nothing here'");
assert.equal(rupeesToPaise("(1,234.56)"), -123456n, "accounting parentheses are negative");
assert.equal(rupeesToPaise("1234.56 DR"), -123456n, "a trailing DR is money out");
assert.equal(rupeesToPaise("1234.56 CR"), 123456n, "a trailing CR is money in");
assert.equal(rupeesToPaise("-50.5"), -5050n, "one decimal is tens of paise");

// Three decimals is a quantity or a rate mapped into a money column. Rounding
// it would produce a number nobody entered.
assert.throws(() => rupeesToPaise("1.234"), /more than two decimals/);
assert.throws(() => rupeesToPaise("twelve"), /not an amount/);
assert.throws(() => rupeesToPaise("12.3.4"), /not an amount/);

// Sums stay exact across a whole file, which is the property that matters.
const cents = ["0.01", "0.02", "0.03", "0.04", "0.05", "0.06", "0.07", "0.08", "0.09", "0.10"];
assert.equal(cents.reduce((a, c) => a + rupeesToPaise(c), 0n), 55n);

/* --- dates: day-first, never Date.parse ----------------------------------- */

assert.equal(toIsoDate("2026-06-01"), "2026-06-01");
assert.equal(toIsoDate("2026/6/1"), "2026-06-01");
// The one that decides which period a settlement lands in. new Date() would
// read this as 2 January in a US locale.
assert.equal(toIsoDate("01/02/2026"), "2026-02-01", "day-first, stated not inherited");
assert.equal(toIsoDate("1-6-2026"), "2026-06-01");
assert.equal(toIsoDate("01-Jun-2026"), "2026-06-01", "HDFC's habit");
assert.equal(toIsoDate("01 June 26"), "2026-06-01", "a full month name and a two-digit year");
assert.throws(() => toIsoDate(""), /empty date/);
assert.throws(() => toIsoDate("01-Jum-2026"), /unknown month/);
assert.throws(() => toIsoDate("last tuesday"), /unrecognised date/);

/* --- mapping -------------------------------------------------------------- */

// A real HDFC statement header. The point is that none of these spellings are
// the field names, and no per-bank branch is involved in matching them.
const hdfc = parseCsv(
  [
    "Date,Narration,Chq / Ref No,Withdrawal Amt.,Deposit Amt.",
    "01-Jun-2026,NEFT-RAZORPAY-UTR7781,UTR7781,,\"2,41,880.00\"",
    "02-Jun-2026,BANK CHARGES,CHG01,118.00,",
  ].join("\n"),
);
const bankMap = detectMapping(hdfc.headers, "bankLines");
assert.equal(bankMap.valueDate, "Date");
assert.equal(bankMap.narration, "Narration");
assert.equal(bankMap.ref, "Chq / Ref No");
assert.equal(bankMap.debitPaise, "Withdrawal Amt.", "'Withdrawal Amt.' is a debit");
assert.equal(bankMap.creditPaise, "Deposit Amt.", "'Deposit Amt.' is a credit");
assert.equal(bankMap.bank, null, "no column for it, so the user is asked rather than guessed at");

const lines = toBundleRows(hdfc, "bankLines", bankMap);
assert.equal(lines.length, 2);
assert.equal(lines[0]!.creditPaise, "24188000");
assert.equal(lines[0]!.debitPaise, "0", "an empty money cell is zero, not undefined");
assert.equal(lines[0]!.valueDate, "2026-06-01");
assert.equal(lines[1]!.debitPaise, "11800");

// Money leaves as a decimal string. A BigInt here would throw inside
// JSON.stringify at the moment of upload, which is the worst place to find out.
assert.equal(typeof lines[0]!.creditPaise, "string");
JSON.stringify(lines);

/* --- refusals ------------------------------------------------------------- */

// A file missing a required column is refused before anything is posted.
assert.throws(
  () => toBundleRows(hdfc, "bankLines", { ...bankMap, narration: null }),
  /unmapped required column: narration/,
);

// A blank required cell names the file's own row number, not a zero-based index.
const gap = parseCsv("Date,Narration,Ref\n01-Jun-2026,NEFT,R1\n02-Jun-2026,,R2\n");
assert.throws(
  () => toBundleRows(gap, "bankLines", detectMapping(gap.headers, "bankLines")),
  /row 3: narration is empty/,
);

// A column mapped to the wrong thing is caught by the value, and the error says
// where. This is the realistic failure: quantity mapped into an amount.
const wrong = parseCsv("Date,Narration,Ref,Deposit Amt.\n01-Jun-2026,NEFT,R1,1.234\n");
assert.throws(
  () => toBundleRows(wrong, "bankLines", detectMapping(wrong.headers, "bankLines")),
  /row 2, column "Deposit Amt\.": more than two decimals/,
);

/* --- period --------------------------------------------------------------- */

assert.equal(periodOf(lines, "valueDate"), "2026-06");
// One stray date from a misparse must not decide the period for the file.
assert.equal(
  periodOf([{ d: "1970-01-01" }, { d: "2026-06-10" }, { d: "2026-06-20" }], "d"),
  "2026-06",
  "the median, not the minimum",
);
assert.equal(periodOf([], "valueDate"), null);

console.log(
  "csv: quoted fields, BOM and embedded newlines parse; rupees convert without a float " +
    "(1,234.56 → 123456, DR and parentheses negative, three decimals refused); dates are " +
    "day-first; an HDFC header maps with no per-bank branch; a wrong column names its own row",
);
