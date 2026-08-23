import assert from "node:assert/strict";

// Neon gives one connection string; the direct URL is derived from it. If that
// derivation is wrong, migrations and (later) pg-boss connect through the
// pooler and fail in ways that look like anything but a bad hostname.
process.env.DATABASE_URL =
  "postgresql://u:p@ep-cool-name-a1b2c3-pooler.ap-south-1.aws.neon.tech/finco?sslmode=require";
const { env } = await import("./env.ts");

assert.equal(
  env.databaseUrlDirect,
  "postgresql://u:p@ep-cool-name-a1b2c3.ap-south-1.aws.neon.tech/finco?sslmode=require",
  "direct URL is the pooled host without -pooler",
);
assert.ok(env.databaseUrlDirect!.includes("u:p@"), "credentials untouched");
assert.equal(env.databaseUrl, process.env.DATABASE_URL, "pooled URL passes through");

console.log("api: direct connection URL derives correctly from DATABASE_URL");
