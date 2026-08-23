import { sql } from "drizzle-orm";
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One close run.
 *
 * Money columns are `bigint` with `mode: "bigint"` — never numeric, never
 * float8. JavaScript's `number` loses integer precision above 2^53 and the
 * failure is silent, so paise never leaves this table as anything else.
 *
 * `inputHash` is the SHA-256 of the sorted, canonicalised inputs. Together with
 * (tenant, period) it makes POST /v1/runs idempotent: the same three files
 * submitted twice resolve to the same run rather than a second one.
 *
 * Defaults are `sql`0`` rather than `0n`: drizzle-kit JSON.stringifies the
 * migration snapshot and throws on a BigInt literal. The column type is
 * unaffected — this only changes how the default reaches the generated SQL.
 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    period: text("period").notNull(), // YYYY-MM
    inputHash: text("input_hash").notNull(),

    state: text("state").notNull().default("INGESTED"),

    totalRows: bigint("total_rows", { mode: "bigint" }).notNull().default(sql`0`),
    matchedRows: bigint("matched_rows", { mode: "bigint" }).notNull().default(sql`0`),
    unprovenPaise: bigint("unproven_paise", { mode: "bigint" }).notNull().default(sql`0`),

    stages: jsonb("stages").$type<Record<string, unknown>>().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("runs_tenant_period_idx").on(t.tenantId, t.period)],
);

export type Run = typeof runs.$inferSelect;
