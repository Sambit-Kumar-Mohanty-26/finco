/**
 * @finco/core — pure domain. Zero IO, zero framework, zero React.
 *
 * Lives here rather than inside apps/web so that apps/api can share the exact
 * same money type. Two implementations of Paise across two services is the
 * failure the build plan warns about: a rounding difference between server and
 * client in a ledger is nearly impossible to debug from a screenshot.
 */
export {
  paise,
  serialisePaise,
  formatINR,
  spokenINR,
  type Paise,
} from "./money.ts";

export { allocate } from "./allocate.ts";
export {
  isBankingDay,
  addBankingDays,
  bankingWindow,
  bankingDaysBetween,
} from "./banking.ts";
