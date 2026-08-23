import { neon, types } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

/**
 * THE MOST IMPORTANT FOUR LINES IN THE REPO.
 *
 * Postgres returns int8 (bigint) as a STRING by default, in node-postgres and
 * in Neon's driver alike. Left alone, `SUM(amount)` comes back as "38144210",
 * and `"38144210" + 723040` in JavaScript is the string "38144210723040". It
 * does not throw. It produces a number that looks plausible in a table and is
 * wrong by nine orders of magnitude.
 *
 * Registering the parser here, before any query runs, is why money can be
 * trusted anywhere downstream. `src/db/bigint.check.mts` asserts it.
 */
types.setTypeParser(20, (v) => BigInt(v)); // oid 20 = int8

export const hasDatabase = Boolean(env.databaseUrl);

export const db = env.databaseUrl
  ? drizzle(neon(env.databaseUrl), { schema })
  : null;

export { schema };
