import { Router } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  bankLines,
  datasets,
  erpInvoices,
  matchLinks,
  reconRows,
  runs,
  settlements,
} from "../db/schema.ts";
import { reconcile } from "../recon/engine.ts";
import { inputHash } from "./datasets.ts";

export const runsRouter = Router();

/**
 * A synchronous run is capped deliberately.
 *
 * Render kills an HTTP request that runs too long, and a run dropped halfway
 * leaves match_links half written with no way to tell a partial run from a
 * finished one. Refuse above the cap with a clear message; P3 lifts it by
 * moving execution to the worker, which is the only correct fix.
 */
const SYNC_ROW_CAP = 1000;

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/** POST /v1/runs — body { datasetId }. Idempotent per (dataset, contents). */
runsRouter.post("/v1/runs", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const datasetId = String(req.body?.datasetId ?? "");
    const [ds] = await db.select().from(datasets).where(eq(datasets.id, datasetId));
    if (!ds) return res.status(404).json({ error: "no such dataset" });

    const rowCount = ds.counts?.reconRows ?? 0;
    if (rowCount > SYNC_ROW_CAP) {
      return res.status(413).json({
        error: `synchronous runs are capped at ${SYNC_ROW_CAP} rows; this dataset has ${rowCount}`,
        hint: "P3 moves execution to the worker and lifts this cap",
      });
    }

    const hash = inputHash(ds.id, ds.counts ?? {});
    const [existing] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.datasetId, ds.id), eq(runs.inputHash, hash)));
    if (existing) return res.status(200).json({ ...existing, reused: true });

    const [run] = await db
      .insert(runs)
      .values({
        datasetId: ds.id,
        period: ds.period,
        inputHash: hash,
        state: "RUNNING",
        startedAt: new Date(),
      })
      .returning();
    if (!run) return res.status(500).json({ error: "run insert returned nothing" });

    const [setls, rows, banks, invoices] = await Promise.all([
      db.select().from(settlements).where(eq(settlements.datasetId, ds.id)).orderBy(asc(settlements.ref)),
      db.select().from(reconRows).where(eq(reconRows.datasetId, ds.id)).orderBy(asc(reconRows.entityId)),
      db.select().from(bankLines).where(eq(bankLines.datasetId, ds.id)).orderBy(asc(bankLines.ref)),
      db.select().from(erpInvoices).where(eq(erpInvoices.datasetId, ds.id)),
    ]);

    const result = reconcile({
      settlements: setls.map((s) => ({
        ref: s.ref,
        utr: s.utr,
        amountPaise: s.amountPaise,
        settledOn: s.settledOn,
        onHold: s.onHold,
      })),
      reconRows: rows.map((r) => ({
        entityId: r.entityId,
        settlementRef: r.settlementRef,
        type: r.type,
        orderId: r.orderId,
        creditPaise: r.creditPaise,
        debitPaise: r.debitPaise,
      })),
      bankLines: banks.map((b) => ({
        ref: b.ref,
        valueDate: b.valueDate,
        creditPaise: b.creditPaise,
        chargesPaise: b.chargesPaise,
        narration: b.narration,
      })),
      erpInvoices: invoices.map((i) => ({
        orderReceipt: i.orderReceipt,
        amountPaise: i.amountPaise,
      })),
    });

    if (result.links.length > 0) {
      const values = result.links.map((l) => ({
        runId: run.id,
        datasetId: ds.id,
        tier: l.tier,
        verdict: l.verdict,
        leftType: l.leftType,
        leftRef: l.leftRef,
        rightType: l.rightType,
        rightRef: l.rightRef,
        amountPaise: l.amountPaise,
        deltaPaise: l.deltaPaise,
        reason: l.reason,
      }));
      for (let i = 0; i < values.length; i += 1000) {
        await db.insert(matchLinks).values(values.slice(i, i + 1000));
      }
    }

    const [done] = await db
      .update(runs)
      .set({
        state: "SCORED",
        totalRows: BigInt(result.totalRows),
        matchedRows: BigInt(result.matchedRows),
        unprovenPaise: result.unprovenPaise,
        // Settlement detail lives in the run so /runs/:id is one read, and so
        // the figures a page shows cannot drift from the run that produced them.
        stages: {
          tiers: result.stages,
          autoMatchPct: result.autoMatchPct,
          settlements: result.settlements.map((s) => ({
            ...s,
            amountPaise: s.amountPaise.toString(),
            deltaPaise: s.deltaPaise.toString(),
          })),
        },
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id))
      .returning();

    res.status(201).json(done ?? { id: run.id, state: "SCORED" });
  } catch (e) {
    next(e);
  }
});

runsRouter.get("/v1/runs", async (_req, res, next) => {
  if (!db) return needDb(res);
  try {
    const rows = await db
      .select()
      .from(runs)
      .orderBy(sql`${runs.createdAt} desc`)
      .limit(50);
    res.json({ runs: rows });
  } catch (e) {
    next(e);
  }
});

runsRouter.get("/v1/runs/:id", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run) return res.status(404).json({ error: "no such run" });
    const links = await db
      .select()
      .from(matchLinks)
      .where(eq(matchLinks.runId, run.id))
      .orderBy(asc(matchLinks.tier), asc(matchLinks.leftRef))
      .limit(500);
    res.json({ ...run, links });
  } catch (e) {
    next(e);
  }
});
