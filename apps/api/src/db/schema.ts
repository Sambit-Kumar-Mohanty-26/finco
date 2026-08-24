import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Money columns are `bigint` with `mode: "bigint"` — never numeric, never
 * float8. JavaScript's `number` loses integer precision above 2^53 and the
 * failure is silent, so paise never leaves these tables as anything else.
 *
 * Defaults are a SQL literal rather than 0n: drizzle-kit JSON.stringifies the
 * migration snapshot and throws on a BigInt. Column types are unaffected.
 */
const money = (name: string) => bigint(name, { mode: "bigint" }).notNull().default(sql`0`);

/** An uploaded scenario. Everything else is scoped to one of these. */
export const datasets = pgTable("datasets", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull().default("demo"),
  name: text("name").notNull(),
  period: text("period").notNull(), // YYYY-MM
  source: text("source").notNull().default("upload"), // upload | seed | razorpay
  counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A Razorpay settlement: the netting event. `amountPaise` is what the bank
 * should credit for this UTR, already net of fee.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(), // setl_...
    utr: text("utr"), // null happens, and is an exception rather than an error
    amountPaise: money("amount_paise"),
    feePaise: money("fee_paise"),
    taxPaise: money("tax_paise"),
    settledOn: date("settled_on").notNull(), // YYYY-MM-DD, the T of T+2
    onHold: boolean("on_hold").notNull().default(false),
    status: text("status").notNull().default("processed"),
  },
  (t) => [
    index("settlements_dataset_idx").on(t.datasetId),
    index("settlements_utr_idx").on(t.datasetId, t.utr),
    index("settlements_ref_idx").on(t.datasetId, t.ref),
  ],
);

/**
 * One line of the Razorpay recon report. `credit` is ALREADY NET OF FEE — do
 * not subtract fee again when proving I1. Doing so understates every
 * settlement by roughly 2.9% of gross, no settlement closes, and the whole run
 * parks in suspense.
 */
export const reconRows = pgTable(
  "recon_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    settlementRef: text("settlement_ref"), // setl_... , null while unsettled
    type: text("type").notNull(), // payment | refund | transfer | adjustment
    entityId: text("entity_id").notNull(), // pay_ | rfnd_ | trf_ | adj_ | setlod_
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    creditPaise: money("credit_paise"),
    debitPaise: money("debit_paise"),
    feePaise: money("fee_paise"),
    taxPaise: money("tax_paise"),
    disputeId: text("dispute_id"),
    onHold: boolean("on_hold").notNull().default(false),
    description: text("description"),
    capturedOn: date("captured_on"),
  },
  (t) => [
    index("recon_rows_dataset_idx").on(t.datasetId),
    index("recon_rows_settlement_idx").on(t.datasetId, t.settlementRef),
    index("recon_rows_order_idx").on(t.datasetId, t.orderId),
  ],
);

/** A line on the bank statement. The UTR usually hides inside `narration`. */
export const bankLines = pgTable(
  "bank_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(), // bnk_...
    valueDate: date("value_date").notNull(),
    creditPaise: money("credit_paise"),
    debitPaise: money("debit_paise"),
    chargesPaise: money("charges_paise"),
    narration: text("narration").notNull(),
    bank: text("bank").notNull().default("HDFC"), // HDFC | ICICI | AXIS | KOTAK
  },
  (t) => [
    index("bank_lines_dataset_idx").on(t.datasetId),
    index("bank_lines_date_idx").on(t.datasetId, t.valueDate),
  ],
);

/** The ERP side. Revenue is recognised from here, never from the payment. */
export const erpInvoices = pgTable(
  "erp_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    invoiceNo: text("invoice_no").notNull(),
    orderReceipt: text("order_receipt").notNull(), // joins to recon_rows.order_id
    amountPaise: money("amount_paise"),
    invoiceDate: date("invoice_date").notNull(),
    customer: text("customer").notNull().default(""),
  },
  (t) => [
    index("erp_invoices_dataset_idx").on(t.datasetId),
    index("erp_invoices_receipt_idx").on(t.datasetId, t.orderReceipt),
  ],
);

/**
 * One close run over one dataset.
 *
 * `inputHash` is the SHA-256 of the sorted, canonicalised inputs. Together with
 * (tenant, period) it makes POST /v1/runs idempotent: the same dataset
 * submitted twice resolves to the same run rather than a second one.
 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    datasetId: uuid("dataset_id").references(() => datasets.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    inputHash: text("input_hash").notNull(),

    state: text("state").notNull().default("INGESTED"),

    totalRows: money("total_rows"),
    matchedRows: money("matched_rows"),
    unprovenPaise: money("unproven_paise"),

    stages: jsonb("stages").$type<Record<string, unknown>>().default({}),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("runs_tenant_period_idx").on(t.tenantId, t.period)],
);

/**
 * What the engine proved, and how.
 *
 * `verdict` is the whole product: PROVEN means an arithmetic identity closed to
 * zero paise. ESCALATED means the numbers added up but not uniquely, which is a
 * coin flip and is never posted.
 */
export const matchLinks = pgTable(
  "match_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id").notNull(),
    tier: text("tier").notNull(), // T0 | T1 | T2
    verdict: text("verdict").notNull(), // PROVEN | ESCALATED | REFUSED
    leftType: text("left_type").notNull(), // bank_line | settlement
    leftRef: text("left_ref").notNull(),
    rightType: text("right_type").notNull(), // settlement | recon_row
    rightRef: text("right_ref").notNull(),
    amountPaise: money("amount_paise"),
    deltaPaise: money("delta_paise"),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("match_links_run_idx").on(t.runId),
    // A bank line or settlement must not be consumed twice across a run.
    index("match_links_left_idx").on(t.runId, t.leftType, t.leftRef),
  ],
);

export type Dataset = typeof datasets.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type ReconRow = typeof reconRows.$inferSelect;
export type BankLine = typeof bankLines.$inferSelect;
export type ErpInvoice = typeof erpInvoices.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type MatchLink = typeof matchLinks.$inferSelect;
