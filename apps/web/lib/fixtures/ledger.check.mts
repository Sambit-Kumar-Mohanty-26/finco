/**
 * The ledger fixtures must tie, or the page is claiming something false.
 *   pnpm --filter @finco/web check:ledger
 *
 * A landing page that shows an unbalanced trial balance under the words
 * "debits equal credits" is worse than showing no ledger at all.
 */
import assert from "node:assert/strict";
import {
  EXCEPTIONS,
  EXCEPTIONS_TOTAL,
  TRIAL_BALANCE,
  TRIAL_TOTAL,
} from "./ledger.ts";
import { RUN } from "./run.ts";
import { journalEntry } from "./landing.ts";
import { STAGES, TOTAL_ROWS } from "./run.ts";

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

// 1. the trial balance balances
const dr = sum(TRIAL_BALANCE.map((r) => r.debit));
const cr = sum(TRIAL_BALANCE.map((r) => r.credit));
assert.equal(dr, cr, `trial balance out by ${dr - cr} paise`);
assert.equal(dr, TRIAL_TOTAL.debit);
assert.equal(cr, TRIAL_TOTAL.credit);

// 2. the journal entry balances
const jdr = sum(journalEntry.lines.map((l) => l.debit));
const jcr = sum(journalEntry.lines.map((l) => l.credit));
assert.equal(jdr, jcr, `journal out by ${jdr - jcr} paise`);
assert.equal(jdr, journalEntry.totalDebit);

// 3. suspense equals the open exceptions, in value and in count
const suspense = TRIAL_BALANCE.find((r) => r.account.startsWith("9999"))!;
const excValue = sum(EXCEPTIONS.map((e) => e.value));
const excItems = EXCEPTIONS.reduce((a, e) => a + e.items, 0);
assert.equal(suspense.debit, excValue, "suspense != sum of exceptions");
assert.equal(excValue, EXCEPTIONS_TOTAL.value);
assert.equal(excItems, EXCEPTIONS_TOTAL.items);

// 4. the same unproven figure appears on the run
assert.equal(RUN.unproven, excValue, "run.unproven != suspense");
assert.equal(RUN.exceptions, excItems);

// 5. the run's stage counts are monotonic and the headline rate is real
let prev = -1;
for (const s of STAGES) {
  assert.ok(s.matched >= prev, `stage ${s.key} goes backwards`);
  prev = s.matched;
}
const finalMatched = STAGES[STAGES.length - 1].matched;
const rate = ((finalMatched / TOTAL_ROWS) * 100).toFixed(1) + "%";
assert.equal(rate, RUN.autoMatch, `auto-match says ${RUN.autoMatch}, rows say ${rate}`);

// 6. the agent stage posts nothing
const agent = STAGES.find((s) => s.kind === "agent")!;
const beforeAgent = STAGES[STAGES.indexOf(agent) - 1];
assert.equal(agent.matched, beforeAgent.matched, "agent moved the count; it proposes only");

console.log("ledger: all checks passed");
