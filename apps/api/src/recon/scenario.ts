import { addBankingDays } from "@finco/core";
import type { BankLineIn, ErpInvoiceIn, ReconRowIn, SettlementIn } from "./engine.ts";

/**
 * The synthetic scenario, with a known answer key.
 *
 * Deterministic from a seed: the same size always produces byte-identical data,
 * which is what makes the golden test meaningful. If the match count moves, the
 * engine changed — not the fixture.
 *
 * The build plan specifies a Python generator in tools/. This is TypeScript
 * instead: the stack decision is TypeScript-everywhere, it reuses the same
 * bigint money path the engine uses, and it means seeding does not require a
 * second toolchain on a developer machine.
 */

export type Scenario = {
  settlements: SettlementIn[];
  reconRows: ReconRowIn[];
  bankLines: BankLineIn[];
  erpInvoices: ErpInvoiceIn[];
  /** What a correct engine must produce. Asserted by the golden test. */
  answerKey: { totalRows: number; settlements: number; seededDefects: string[] };
};

/** Deterministic LCG. Not cryptographic — reproducibility is the whole point. */
function rng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s % max;
  };
}

const pad = (n: number, w = 4) => String(n).padStart(w, "0");

/** Razorpay's standard MDR: 2% plus 18% GST on the fee. */
function feeFor(amount: bigint): { fee: bigint; tax: bigint } {
  const base = (amount * 2n) / 100n;
  const tax = (base * 18n) / 100n;
  return { fee: base + tax, tax };
}

const NARRATIONS: ((utr: string) => string)[] = [
  (u) => `NEFT CR-${u}-RAZORPAY SOFTWARE PVT-HDFC0000060`,
  (u) => `MMT/IMPS/${u}/RAZORPAY/HDFC`,
  (u) => `UTR:${u} RAZORPAY SOFTWA`,
  (u) => `RAZORPAY SOFTWARE PRIVATE LIMI-${u}`,
];
const BANKS = ["HDFC", "ICICI", "AXIS", "KOTAK"] as const;

export function buildScenario(rows: number, seed = 20260824): Scenario {
  const r = rng(seed);
  const settlements: SettlementIn[] = [];
  const reconRows: ReconRowIn[] = [];
  const bankLines: BankLineIn[] = [];
  const erpInvoices: ErpInvoiceIn[] = [];
  const defects: string[] = [];

  // Roughly 40 rows per settlement, as a real merchant day looks.
  const perSettlement = 40;
  const count = Math.max(1, Math.ceil(rows / perSettlement));
  let rowNo = 0;
  let bankNo = 0;

  for (let i = 0; i < count && rowNo < rows; i++) {
    const ref = `setl_${pad(i)}`;
    const settledOn = addBankingDays("2026-06-01", i % 20);
    const utr = `KKBKH${pad(1000 + i, 4)}${pad(100000 + i * 7, 6)}`;

    // Defect frequencies are small primes so that the same rates hold at 500
    // rows (13 settlements) and at 50,000. Moduli of 17 or 23 simply never fire
    // on a small scenario, which quietly turns the golden test into a no-op.
    const onHold = i > 0 && i % 12 === 0; // E05: no bank credit expected at all

    let net = 0n;
    const mine: ReconRowIn[] = [];
    for (let k = 0; k < perSettlement && rowNo < rows; k++, rowNo++) {
      const orderId = `order_${pad(rowNo, 6)}`;
      const gross = BigInt(50_00 + r(4_950_00)) * 100n; // ₹50 to ₹5,000, in paise
      const { fee, tax } = feeFor(gross);
      const credit = gross - fee; // already net of fee — never subtract it twice

      // 3% of rows are refunds against an earlier payment: a debit, prior period.
      if (rowNo % 33 === 32) {
        const debit = BigInt(10_00 + r(400_00)) * 100n;
        mine.push({
          entityId: `rfnd_${pad(rowNo, 6)}`,
          settlementRef: ref,
          type: "refund",
          orderId,
          creditPaise: 0n,
          debitPaise: debit,
        });
        net -= debit;
        continue;
      }

      mine.push({
        entityId: `pay_${pad(rowNo, 6)}`,
        settlementRef: ref,
        type: "payment",
        orderId,
        creditPaise: credit,
        debitPaise: 0n,
      });
      net += credit;

      // Roughly 1% of payments have no ERP invoice: an orphan (E09). The row exists
      // and the money is real, but revenue cannot be recognised against it.
      if (rowNo % 97 !== 96) {
        erpInvoices.push({ orderReceipt: orderId, amountPaise: gross });
      } else if (defects.length < 40) {
        defects.push(`E09 orphan payment ${orderId}`);
      }
    }
    reconRows.push(...mine);

    // Every 7th settlement carries an unexplained adjustment that is NOT
    // reflected in the settlement amount, so I1 fails by exactly that amount.
    const broken = i > 0 && i % 9 === 0;
    if (broken) {
      const adj = BigInt(1_00 + r(9_00)) * 100n;
      reconRows.push({
        entityId: `adj_${pad(i, 4)}`,
        settlementRef: ref,
        type: "adjustment",
        orderId: null,
        creditPaise: adj,
        debitPaise: 0n,
      });
      defects.push(`E14 unexplained adjustment on ${ref} (${adj} paise)`);
      // net deliberately NOT updated: this is the seeded identity break.
    }

    settlements.push({ ref, utr, amountPaise: net, settledOn, onHold });

    if (onHold) {
      defects.push(`E05 settlement on hold ${ref}`);
      continue; // no bank credit for a held settlement
    }

    // Two narration defects, recovered by different tiers — which is the point
    // of having tiers at all.
    //   mangled: delimiters stripped, so every regex fails but the UTR is still
    //            in there verbatim. T1's substring pass gets it.
    //   unreadable: no UTR at all. Only T2's amount-and-window pass can.
    const mangled = i > 0 && i % 10 === 0;
    const unreadable = i > 0 && i % 8 === 0;
    const narration = mangled
      ? `BYTRANSFERRAZORPAYSOFTWAREPVTLTD${utr}COLLECTIONSBATCH${pad(i, 4)}`
      : unreadable
        ? `NEFT CR-RAZORPAY SOFTWARE PVT LTD COLLECTIONS ${pad(i, 4)}`
        : NARRATIONS[i % NARRATIONS.length]!(utr);
    if (mangled) defects.push(`E07 narration mangled on bnk_${pad(bankNo)} (T1 recovers)`);
    else if (unreadable) defects.push(`E07 UTR not extractable on bnk_${pad(bankNo)} (T2 recovers)`);

    // Bank charges on ~1 in 11 credits, which I2 must account for.
    const charges = i % 11 === 5 ? 590n : 0n;

    bankLines.push({
      ref: `bnk_${pad(bankNo++)}`,
      valueDate: addBankingDays(settledOn, i % 3), // inside the T+2 window
      creditPaise: net - charges,
      chargesPaise: charges,
      narration,
    });
  }

  return {
    settlements,
    reconRows,
    bankLines,
    erpInvoices,
    answerKey: {
      totalRows: reconRows.length,
      settlements: settlements.length,
      seededDefects: defects,
    },
  };
}

export const BANK_FORMATS = BANKS;
