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
  uniqueIndex,
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
  /**
   * How a seeded dataset was generated, so the scorer can rebuild its truth
   * file from scratch. The truth itself is NEVER stored: nothing the engine can
   * read may contain the answers, or the scorecard measures its own fixture.
   */
  seedSpec: jsonb("seed_spec").$type<{ size: number; seed: number } | null>(),
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
    // A non-INR booking settles in INR at a rate nobody recorded here, which is
    // an exception class (E11) rather than a display detail.
    currency: text("currency").notNull().default("INR"),
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
    // The idempotency key. A resumed job replays the tiers it already ran, so
    // every link write is ON CONFLICT DO NOTHING against this: a redeploy
    // mid-run cannot post the same match a second time.
    uniqueIndex("match_links_idem_uk").on(t.runId, t.tier, t.leftRef, t.rightRef),
  ],
);

/**
 * The job queue — a table, not a broker.
 *
 * pg-boss was the plan, and it needs the unpooled connection because its
 * LISTEN misbehaves through Neon's pooler. One `FOR UPDATE SKIP LOCKED`
 * statement does the same job here in ten lines, works over the HTTP driver,
 * and removes both the dependency and the second connection string. The cost is
 * polling instead of notification: at one run per close that is not a cost.
 *
 * `stage` is the last tier committed. A worker killed mid-run resumes from it.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id").notNull(),
    kind: text("kind").notNull().default("close_run"),
    state: text("state").notNull().default("QUEUED"), // QUEUED | RUNNING | DONE | FAILED
    stage: text("stage").notNull().default(""),
    attempts: bigint("attempts", { mode: "number" }).notNull().default(0),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_state_idx").on(t.state, t.createdAt),
    // One job per run, so a retried POST cannot queue the work twice.
    uniqueIndex("jobs_run_uk").on(t.runId),
  ],
);

/**
 * The progress log a run streams from.
 *
 * `seq` is derived from the stage ordinal, never from a counter, so a resumed
 * run re-emits the same numbers and `Last-Event-ID` means the same thing across
 * a redeploy. Unique on (run, seq): replay writes nothing new.
 */
export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(), // stage | finished | failed
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_events_seq_uk").on(t.runId, t.seq)],
);

/**
 * The typed exception queue. One row per (run, code, subject).
 *
 * The unique key is what makes a resumed or re-run close idempotent: the same
 * evidence produces the same exception, and re-classification updates it rather
 * than filling the queue with duplicates of work somebody already did.
 */
export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id").notNull(),
    tenantId: text("tenant_id").notNull().default("demo"),
    code: text("code").notNull(), // E01..E14
    subjectType: text("subject_type").notNull(), // settlement | bank_line | recon_row
    subjectRef: text("subject_ref").notNull(),
    amountPaise: money("amount_paise"),
    parksTo: text("parks_to").notNull().default("9999"),
    autoResolvable: boolean("auto_resolvable").notNull().default(false),
    reason: text("reason").notNull().default(""),
    asOf: date("as_of"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("OPEN"), // OPEN | RESOLVED | REVERSED
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    journalEntryId: uuid("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("exceptions_run_idx").on(t.runId, t.status),
    index("exceptions_code_idx").on(t.runId, t.code),
    uniqueIndex("exceptions_subject_uk").on(t.runId, t.code, t.subjectRef),
  ],
);

/**
 * The ledger. Append-only: nothing is ever updated or deleted.
 *
 * A correction is a reversing entry pointing at what it reverses, because an
 * auditor has to be able to see that a mistake was made and how it was undone.
 * An UPDATE would leave the books tidy and the history gone.
 *
 * `sourceRef` is the idempotency key. Posting the same exception twice — from a
 * retried request or a resumed job — hits the unique index and does nothing.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    period: text("period").notNull(),
    memo: text("memo").notNull().default(""),
    sourceType: text("source_type").notNull(), // settlement | exception | reversal
    sourceRef: text("source_ref").notNull(),
    reversalOf: uuid("reversal_of"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_entries_run_idx").on(t.runId),
    uniqueIndex("journal_entries_source_uk").on(t.tenantId, t.sourceType, t.sourceRef),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    account: text("account").notNull(), // one of the ten in @finco/core
    debitPaise: money("debit_paise"),
    creditPaise: money("credit_paise"),
    memo: text("memo").notNull().default(""),
    sourceType: text("source_type").notNull().default(""),
    sourceRef: text("source_ref").notNull().default(""),
  },
  (t) => [
    index("journal_lines_entry_idx").on(t.entryId),
    index("journal_lines_account_idx").on(t.account),
  ],
);

/**
 * Own auth. No third-party identity provider.
 *
 * `passwordHash` is scrypt with a per-user salt; `sessions.tokenHash` is the
 * SHA-256 of a token that exists in plaintext only in the user's cookie. A dump
 * of either table cannot be replayed as a login.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    email: text("email").notNull(),
    // Nullable: an account created through Google has no password and never
    // will. A sentinel hash would be a password that something could match.
    passwordHash: text("password_hash"),
    name: text("name").notNull().default(""),
    role: text("role").notNull().default("viewer"), // viewer | preparer | approver
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uk").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_uk").on(t.tokenHash)],
);

/**
 * Every model call, with what it cost and whether the verifier agreed.
 *
 * `promptHash` doubles as the cache key. At temperature 0 the same prompt has
 * one answer, so a replayed run reuses the stored response instead of paying
 * for it again — which is also what keeps a replay byte-identical.
 */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    promptHash: text("prompt_hash").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costPaise: money("cost_paise"),
    latencyMs: bigint("latency_ms", { mode: "number" }).notNull().default(0),
    verdict: text("verdict").notNull().default(""), // ACCEPT | REJECT | ESCALATE | NONE
    response: jsonb("response").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_calls_run_idx").on(t.runId),
    uniqueIndex("llm_calls_prompt_uk").on(t.promptHash),
  ],
);

/**
 * Per-tenant policy. P8 moves these OUT of env, where they were a deploy-wide
 * constant, into a row a controller can change and an auditor can read the
 * history of.
 *
 * The kill switch is the load-bearing field. When it is on, nothing posts
 * automatically — every outcome routes to review, whatever the verifier said —
 * and a banner appears on every screen. It exists because the correct response
 * to "something is wrong and I do not yet know what" is to stop posting, not to
 * redeploy.
 */
export const policies = pgTable(
  "policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    /** proven+unique claims below this post themselves. Above it, a person looks. */
    autonomyCapPaise: money("autonomy_cap_paise"),
    /** Rounding drift at or under this is absorbed rather than parked. */
    materialityPaise: money("materiality_paise"),
    /** The fortnight floor the cash page judges against, on p10. */
    cashFloorPaise: money("cash_floor_paise"),
    /**
     * How much may sit in suspense before it is an alert.
     *
     * Suspense is a waiting room, not an account, and the number that says
     * whether a close WORKED is how little is parked in it. A ceiling makes
     * that a threshold somebody set rather than a figure nobody looked at.
     */
    suspenseCeilingPaise: money("suspense_ceiling_paise"),
    /** observe | assist | auto — the three-position autonomy control. */
    autonomyMode: text("autonomy_mode").notNull().default("assist"),
    killSwitch: boolean("kill_switch").notNull().default(false),
    killReason: text("kill_reason").notNull().default(""),
    updatedBy: text("updated_by").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("policies_tenant_uk").on(t.tenantId)],
);

/**
 * Razorpay webhook deliveries, stored before they are believed.
 *
 * Unique on the provider's event id, which is what makes redelivery a no-op —
 * and Razorpay WILL redeliver, because it retries anything it did not get a
 * 2xx for within a few seconds. The raw body is kept because the signature is
 * over bytes, not over parsed JSON, and a re-verification after the fact is
 * impossible from a re-serialised object.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    provider: text("provider").notNull().default("razorpay"),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull().default(""),
    signatureOk: boolean("signature_ok").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Set once the event has been folded into a dataset. Null means received only. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_events_uk").on(t.provider, t.eventId),
    index("webhook_events_type_idx").on(t.tenantId, t.eventType),
  ],
);

/**
 * The audit log, hash-chained.
 *
 * Each row carries the hash of the row before it, so removing or editing an
 * entry breaks every hash after it and the break is detectable by replaying the
 * chain. This is not tamper-PROOF — anyone with write access can recompute the
 * whole chain — it is tamper-EVIDENT, which is the honest claim and the one
 * that matters when somebody asks who approved a fifty-lakh write-off.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    seq: bigint("seq", { mode: "number" }).notNull(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email").notNull().default(""),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull().default(""),
    subjectRef: text("subject_ref").notNull().default(""),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash").notNull().default(""),
    hash: text("hash").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("audit_log_seq_uk").on(t.tenantId, t.seq)],
);

/**
 * A close period and its lock.
 *
 * Locking is the point. Once a period is closed the books for it stop moving,
 * so a later correction is a new entry in an open period rather than a quiet
 * edit to a month somebody already reported on.
 */
export const periods = pgTable(
  "periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("demo"),
    period: text("period").notNull(), // YYYY-MM
    state: text("state").notNull().default("OPEN"), // OPEN | LOCKED
    /** Which checklist items are ticked, and by whom. */
    checklist: jsonb("checklist").$type<Record<string, { at: string; by: string }>>().notNull().default({}),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("periods_tenant_uk").on(t.tenantId, t.period)],
);

export type Dataset = typeof datasets.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type ReconRow = typeof reconRows.$inferSelect;
export type BankLine = typeof bankLines.$inferSelect;
export type ErpInvoice = typeof erpInvoices.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type MatchLink = typeof matchLinks.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type ExceptionRow = typeof exceptions.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLineRow = typeof journalLines.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type LlmCall = typeof llmCalls.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Period = typeof periods.$inferSelect;
