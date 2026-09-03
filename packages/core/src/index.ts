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

export {
  countSubsets,
  findSubset,
  solveSubset,
  SUBSET_CANDIDATE_CAP,
  type SubsetOutcome,
} from "./subset.ts";

export {
  ACCOUNTS,
  SUSPENSE,
  accountName,
  isAccount,
  checkBalanced,
  nonZero,
  type Account,
  type AccountType,
  type JournalLine,
} from "./accounts.ts";

export {
  EXCEPTION_SPECS,
  EXCEPTION_CODES,
  isExceptionCode,
  coerceCode,
  type ExceptionCode,
  type ExceptionSpec,
  type Owner,
} from "./exceptions.ts";

export {
  ageing,
  BUCKETS,
  DOMESTIC_LAG,
  fitPropensity,
  floorCheck,
  forecast,
  INTERNATIONAL_LAG,
  lagFor,
  settlementDue,
  type AgeingBucket,
  type FloorVerdict,
  type ForecastPoint,
  type PendingRow,
  type Propensity,
} from "./forecast.ts";
