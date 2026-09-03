import { createHash } from "node:crypto";
import { Router } from "express";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { bankLines, datasets, erpInvoices, reconRows, settlements } from "../db/schema.ts";
import { buildScenario } from "../recon/scenario.ts";
import { parseNarration } from "../recon/narration.ts";

export const datasetsRouter = Router();

/**
 * Neon is reached over HTTP, which has no COPY. Multi-row inserts of 1,000 are
 * the substitute: row-by-row inserts across even 10 ms of latency turn a 5,000
 * row upload into minutes, and discovering that at 50,000 rows means rewriting
 * the ingest path rather than tuning it.
 */
const BATCH = 1000;

async function insertAll<T>(
  table: Parameters<NonNullable<typeof db>["insert"]>[0],
  rows: T[],
): Promise<number> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db!
      .insert(table)
      .values(rows.slice(i, i + BATCH) as never)
      .execute();
  }
  return rows.length;
}

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * Ingest one bundle and return the dataset row.
 *
 * Extracted from the route because the nightly Razorpay pull needs the exact
 * same mapping. Two copies of "which field is paise" is how a cron job ends up
 * off by a factor of a hundred against the API that agrees with it.
 */
export async function ingestBundle(
  bundle: {
    settlements: Record<string, unknown>[];
    reconRows: Record<string, unknown>[];
    bankLines?: Record<string, unknown>[];
    erpInvoices?: Record<string, unknown>[];
  },
  meta: {
    name: string;
    period: string;
    source: string;
    tenantId?: string;
    seedSpec?: { size: number; seed: number } | null;
  },
) {
    const counts = {
      settlements: bundle.settlements.length,
      reconRows: bundle.reconRows.length,
      bankLines: bundle.bankLines?.length ?? 0,
      erpInvoices: bundle.erpInvoices?.length ?? 0,
    };

    const [ds] = await db!
      .insert(datasets)
      .values({
        name: meta.name,
        period: meta.period,
        source: meta.source,
        tenantId: meta.tenantId ?? "demo",
        counts,
        seedSpec: meta.seedSpec ?? null,
      })
      .returning();
    if (!ds) throw new Error("dataset insert returned nothing");

    // Money arrives as decimal strings on the wire — JSON has no bigint — and
    // is converted exactly once, here at the boundary.
    const P = (v: unknown) => BigInt(v as string | number | bigint);

    await insertAll(
      settlements,
      bundle.settlements.map((s: Record<string, unknown>) => ({
        datasetId: ds.id,
        ref: String(s.ref),
        utr: s.utr == null ? null : String(s.utr),
        amountPaise: P(s.amountPaise),
        feePaise: P(s.feePaise ?? 0),
        taxPaise: P(s.taxPaise ?? 0),
        settledOn: String(s.settledOn),
        onHold: Boolean(s.onHold),
      })),
    );

    await insertAll(
      reconRows,
      bundle.reconRows.map((r: Record<string, unknown>) => ({
        datasetId: ds.id,
        settlementRef: r.settlementRef == null ? null : String(r.settlementRef),
        type: String(r.type),
        entityId: String(r.entityId),
        orderId: r.orderId == null ? null : String(r.orderId),
        paymentId: r.paymentId == null ? null : String(r.paymentId),
        creditPaise: P(r.creditPaise ?? 0),
        debitPaise: P(r.debitPaise ?? 0),
        feePaise: P(r.feePaise ?? 0),
        taxPaise: P(r.taxPaise ?? 0),
        disputeId: r.disputeId == null ? null : String(r.disputeId),
        description: r.description == null ? null : String(r.description),
        currency: String(r.currency ?? "INR"),
        capturedOn: r.capturedOn == null ? null : String(r.capturedOn),
      })),
    );

    await insertAll(
      bankLines,
      (bundle.bankLines ?? []).map((b: Record<string, unknown>) => ({
        datasetId: ds.id,
        ref: String(b.ref),
        valueDate: String(b.valueDate),
        creditPaise: P(b.creditPaise ?? 0),
        debitPaise: P(b.debitPaise ?? 0),
        chargesPaise: P(b.chargesPaise ?? 0),
        narration: String(b.narration),
        bank: String(b.bank ?? "HDFC"),
      })),
    );

    await insertAll(
      erpInvoices,
      (bundle.erpInvoices ?? []).map((e: Record<string, unknown>, i: number) => ({
        datasetId: ds.id,
        invoiceNo: String(e.invoiceNo ?? `INV-${String(i + 1).padStart(6, "0")}`),
        orderReceipt: String(e.orderReceipt),
        amountPaise: P(e.amountPaise),
        invoiceDate: String(e.invoiceDate ?? "2026-06-01"),
        customer: String(e.customer ?? ""),
      })),
    );

  return { ...ds, counts };
}

/** POST /v1/datasets — ingest a scenario. `{ generate: 5000 }` seeds one. */
datasetsRouter.post("/v1/datasets", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const body = req.body ?? {};
    const size = Number(body.generate ?? 0);
    const bundle = size > 0 ? buildScenario(size, Number(body.seed ?? 20260824)) : body;

    if (!Array.isArray(bundle.settlements) || !Array.isArray(bundle.reconRows)) {
      return res.status(400).json({
        error: "expected { generate: n } or { settlements, reconRows, bankLines, erpInvoices }",
      });
    }
    if (bundle.reconRows.length > 50_000) {
      return res.status(413).json({ error: "50,000 rows is the ingest cap" });
    }

    const ds = await ingestBundle(bundle, {
      name: body.name ?? (size > 0 ? `Seeded scenario · ${size} rows` : "Uploaded scenario"),
      period: body.period ?? "2026-06",
      source: size > 0 ? "seed" : "upload",
      tenantId: req.actor?.tenantId,
      seedSpec: size > 0 ? { size, seed: Number(body.seed ?? 20260824) } : null,
    });

    res.status(201).json(ds);
  } catch (e) {
    next(e);
  }
});

/** GET /v1/datasets — newest first. */
datasetsRouter.get("/v1/datasets", async (_req, res, next) => {
  if (!db) return needDb(res);
  try {
    const rows = await db
      .select()
      .from(datasets)
      .orderBy(sql`${datasets.createdAt} desc`)
      .limit(50);
    res.json({ datasets: rows });
  } catch (e) {
    next(e);
  }
});

datasetsRouter.get("/v1/datasets/:id", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [ds] = await db.select().from(datasets).where(eq(datasets.id, req.params.id));
    if (!ds) return res.status(404).json({ error: "no such dataset" });
    res.json(ds);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /v1/datasets/:id/rows?source=recon|bank|erp|settlements&cursor=&q=
 *
 * Keyset pagination on id, not OFFSET: offset re-scans everything it skips, so
 * page 40 of a 50,000 row table costs forty times page 1. The cursor is the
 * last id seen.
 */
datasetsRouter.get("/v1/datasets/:id/rows", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const id = req.params.id;
    const source = String(req.query.source ?? "recon");
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const q = req.query.q ? String(req.query.q).trim() : "";

    const table = { recon: reconRows, bank: bankLines, erp: erpInvoices, settlements }[
      source
    ];
    if (!table) return res.status(400).json({ error: "source must be recon, bank, erp or settlements" });

    const where = [eq(table.datasetId, id)];
    if (cursor) where.push(gt(table.id, cursor));
    if (q) {
      // ILIKE across the identifying columns of whichever source is selected.
      const like = `%${q}%`;
      const cols =
        source === "recon"
          ? [reconRows.entityId, reconRows.orderId, reconRows.settlementRef, reconRows.type]
          : source === "bank"
            ? [bankLines.ref, bankLines.narration]
            : source === "erp"
              ? [erpInvoices.invoiceNo, erpInvoices.orderReceipt, erpInvoices.customer]
              : [settlements.ref, settlements.utr];
      where.push(sql`(${sql.join(cols.map((c) => sql`${c} ilike ${like}`), sql` or `)})`);
    }

    const rows = await db
      .select()
      .from(table)
      .where(and(...where))
      .orderBy(asc(table.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // The bank tab shows what the parser actually extracted, so a narration the
    // engine cannot read is visible before a run is ever started.
    const decorated =
      source === "bank"
        ? page.map((r) => {
            const line = r as unknown as { narration: string };
            return { ...r, parsed: parseNarration(line.narration) };
          })
        : page;

    res.json({
      rows: decorated,
      nextCursor: hasMore ? page.at(-1)?.id : null,
    });
  } catch (e) {
    next(e);
  }
});

/** Stable hash of a dataset's contents, for run idempotency. */
export function inputHash(datasetId: string, counts: Record<string, number>): string {
  return createHash("sha256")
    .update(datasetId)
    .update(JSON.stringify(Object.entries(counts).sort()))
    .digest("hex")
    .slice(0, 32);
}
