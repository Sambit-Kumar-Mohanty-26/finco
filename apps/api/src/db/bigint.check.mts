/**
 * Asserts the int8 parser is registered.
 *
 *   pnpm --filter @finco/api check
 *
 * Without it, Postgres hands bigints back as strings and `"38144210" + 723040`
 * silently concatenates into a number wrong by nine orders of magnitude. This
 * check needs no database — it verifies the parser registration itself, so it
 * runs in CI where there are no credentials.
 */
import assert from "node:assert/strict";
import { types } from "@neondatabase/serverless";

await import("./index.ts"); // registering the parser is a side effect of importing

// getTypeParser is typed as returning unknown, so narrow it once here
const parse = types.getTypeParser(20) as (v: string) => bigint; // oid 20 = int8
const parsed = parse("9007199254740993");

assert.equal(typeof parsed, "bigint", "int8 must parse to bigint, not string");
assert.equal(parsed, 9007199254740993n, "value must survive above 2^53");
assert.notEqual(typeof parsed, "string");

// The bug this prevents: WITHOUT the parser, Postgres hands back the string
// "38144210" and adding to it concatenates instead of summing. With the parser
// the same value is a bigint and arithmetic is exact.
assert.equal("38144210" + 723040, "38144210723040", "this is the failure mode");
assert.equal(parse("38144210") + 723040n, 38867250n, "with the parser, it sums");

console.log("api: int8 parser registered — bigint round-trips intact");
