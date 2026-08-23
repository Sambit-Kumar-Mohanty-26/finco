import { Router } from "express";
import { sql } from "drizzle-orm";
import { db, hasDatabase } from "../db/index.ts";
import { env } from "../env.ts";

/**
 * The P0 gate: API time, DB time, deployed SHA.
 *
 * Reports the database as a status rather than throwing, so the service is
 * observable before Neon exists and stays up if the database blips. It also
 * returns the type of the value Postgres handed back for a bigint — if that
 * ever reads "string" instead of "bigint", the int8 parser has been lost and
 * every money figure downstream is silently wrong.
 */
export const health = Router();

health.get("/health", async (_req, res) => {
  const apiTime = new Date().toISOString();
  const started = Date.now();

  let database: Record<string, unknown> = {
    connected: false,
    reason: hasDatabase ? "not queried" : "DATABASE_URL not set",
  };

  if (db) {
    try {
      const result = await db.execute<{ now: string; big: bigint }>(
        sql`select now() as now, (9007199254740993)::int8 as big`,
      );
      const row = result.rows[0];
      database = {
        connected: true,
        time: row?.now,
        latencyMs: Date.now() - started,
        // proves the int8 parser survived; "string" here is a P0 failure
        bigintParser: typeof row?.big,
        bigintRoundTrip: String(row?.big),
      };
    } catch (err) {
      database = { connected: false, reason: (err as Error).message.slice(0, 200) };
    }
  }

  res.json({
    ok: true,
    service: "@finco/api",
    apiTime,
    database,
    gitSha: env.gitSha,
    env: env.nodeEnv,
  });
});
