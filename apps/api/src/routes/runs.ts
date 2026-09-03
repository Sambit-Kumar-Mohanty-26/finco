import { Router } from "express";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { datasets, exceptions, matchLinks, runEvents, runs } from "../db/schema.ts";
import { enqueue } from "../queue.ts";
import { loadInputs, SEQ_FINISHED } from "../runner.ts";
import { reconcile } from "../recon/engine.ts";
import { buildScenario } from "../recon/scenario.ts";
import { gate, score, THRESHOLDS, truthFor } from "../score.ts";
import { inputHash } from "./datasets.ts";

export const runsRouter = Router();

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * POST /v1/runs — body { datasetId }. Enqueues; the worker executes.
 *
 * 202 rather than 201: the run exists, the answer does not yet. The old
 * synchronous path capped datasets at 1,000 rows because Render kills a long
 * request and a half-written run is indistinguishable from a finished one.
 * Moving execution to the worker is what lifts the cap — the request now does
 * two inserts and returns.
 *
 * Idempotent on (dataset, contents): re-posting returns the existing run rather
 * than starting a second close over the same numbers.
 */
runsRouter.post("/v1/runs", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const datasetId = String(req.body?.datasetId ?? "");
    const [ds] = await db.select().from(datasets).where(eq(datasets.id, datasetId));
    if (!ds) return res.status(404).json({ error: "no such dataset" });

    const hash = inputHash(ds.id, ds.counts ?? {});
    const [existing] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.datasetId, ds.id), eq(runs.inputHash, hash)));
    if (existing) {
      // A run that died with its worker is requeued rather than left stuck.
      if (existing.state.startsWith("RUNNING") || existing.state === "FAILED") {
        await enqueue(db, existing.id, ds.id);
      }
      return res.status(200).json({ ...existing, reused: true });
    }

    const [run] = await db
      .insert(runs)
      .values({ datasetId: ds.id, period: ds.period, inputHash: hash, state: "QUEUED" })
      .returning();
    if (!run) return res.status(500).json({ error: "run insert returned nothing" });

    await enqueue(db, run.id, ds.id);
    res.status(202).json({ ...run, stream: `/v1/runs/${run.id}/stream` });
  } catch (e) {
    next(e);
  }
});

runsRouter.get("/v1/runs", async (_req, res, next) => {
  if (!db) return needDb(res);
  try {
    const rows = await db.select().from(runs).orderBy(sql`${runs.createdAt} desc`).limit(50);
    res.json({ runs: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /v1/runs/:id/stream — server-sent events.
 *
 * SSE rather than a websocket: progress is one-directional, and EventSource
 * reconnects and replays Last-Event-ID on its own, which is most of what a
 * websocket would have to be taught by hand.
 *
 * Events are read from the run_events TABLE rather than pushed from the worker,
 * because the worker is a different process on a different machine and Neon's
 * HTTP driver has no LISTEN. The table is also what makes a late subscriber
 * work: connecting after the run finished replays every stage from seq 0 and
 * ends, so a finished run renders through exactly the same code path as a live
 * one. That is the property the phase plan actually asks for.
 */
runsRouter.get("/v1/runs/:id/stream", async (req, res, next) => {
  if (!db) return needDb(res);
  const runId = req.params.id;
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (!run) return res.status(404).json({ error: "no such run" });

    // A reconnecting EventSource sends the last id it saw; anything at or below
    // it has already been rendered and must not be replayed.
    const lastHeader = req.headers["last-event-id"];
    const fromQuery = Number(req.query.lastEventId ?? NaN);
    let cursor = Number(Array.isArray(lastHeader) ? lastHeader[0] : lastHeader);
    if (!Number.isFinite(cursor)) cursor = Number.isFinite(fromQuery) ? fromQuery : 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Render and most proxies buffer responses by default, which turns a
      // live stream into one delivery at the end.
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 2000\n\n`);

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const send = (seq: number, type: string, data: unknown) =>
      res.write(`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

    // ponytail: 500ms poll. A close emits seven events over a minute or two, so
    // LISTEN on the direct connection would be machinery for no user-visible gain.
    const deadline = Date.now() + 10 * 60_000;
    while (!closed && Date.now() < deadline) {
      const events = await db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, cursor)))
        .orderBy(asc(runEvents.seq));

      for (const e of events) {
        send(e.seq, e.type, e.payload);
        cursor = e.seq;
      }
      if (cursor >= SEQ_FINISHED) break;
      // A comment line keeps proxies and the browser from timing the idle
      // connection out while the worker is still on its first tier.
      res.write(": keep-alive\n\n");
      await new Promise((r) => setTimeout(r, 500));
    }
    res.end();
  } catch (e) {
    next(e);
  }
});

runsRouter.get("/v1/runs/:id", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run) return res.status(404).json({ error: "no such run" });
    const [links, events, [counts]] = await Promise.all([
      db
        .select()
        .from(matchLinks)
        .where(eq(matchLinks.runId, run.id))
        .orderBy(asc(matchLinks.tier), asc(matchLinks.leftRef))
        .limit(500),
      db.select().from(runEvents).where(eq(runEvents.runId, run.id)).orderBy(asc(runEvents.seq)),
      db
        .select({
          open: sql<number>`count(*) filter (where ${exceptions.status} = 'OPEN')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(exceptions)
        .where(eq(exceptions.runId, run.id)),
    ]);
    res.json({ ...run, links, events, exceptions: counts ?? { open: 0, total: 0 } });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /v1/runs/:id/scorecard
 *
 * The run is REPLAYED from its stored inputs rather than reconstructed from
 * match_links, and the truth is regenerated from the dataset's seed. Two
 * consequences, both deliberate: the answers never sit anywhere the engine can
 * read them, and a scorecard that disagrees with the recorded run is itself the
 * signal that the engine stopped being deterministic.
 *
 * On an uploaded dataset there is no seed and therefore no truth, and the
 * scorecard says precision is not measurable instead of printing 1.000.
 */
runsRouter.get("/v1/runs/:id/scorecard", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run?.datasetId) return res.status(404).json({ error: "no such run" });
    const [ds] = await db.select().from(datasets).where(eq(datasets.id, run.datasetId));

    const input = await loadInputs(db, run.datasetId);
    const replay = reconcile(input);
    const card = score(input, replay, truthFor(ds?.seedSpec));

    res.json({
      ...card,
      runId: run.id,
      period: run.period,
      thresholds: THRESHOLDS,
      failures: gate(card),
      // If the replay disagrees with what was committed, every number above is
      // describing a different run from the one in the ledger. Say so loudly.
      replayMatchesRun:
        BigInt(replay.matchedRows) === run.matchedRows && BigInt(replay.totalRows) === run.totalRows,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /v1/eval/scale — the scale curve.
 *
 * Quality is a property of the ENGINE, not of one run, so this is not keyed on
 * a run id: it rebuilds the synthetic scenario at four sizes and scores each.
 * The point of the largest sample is that precision must not decay with volume
 * — a matcher that only works on a small file is a demo.
 *
 * Computed once per process rather than cached in a table. The engine is pure,
 * the whole curve is under a second, and a stored curve is a number that can
 * silently describe an older engine than the one running.
 */
let curveCache: unknown = null;

runsRouter.get("/v1/eval/scale", (_req, res, next) => {
  try {
    if (!curveCache) {
      curveCache = [50, 500, 5000, 50000].map((rows) => {
        const s = buildScenario(rows);
        const t0 = performance.now();
        const r = reconcile(s);
        const ms = Math.round(performance.now() - t0);
        const card = score(s, r, s.truth);
        return {
          rows: card.totalRows,
          ms,
          autoMatchPct: card.autoMatchPct,
          precision: card.precision,
          recall: card.recall,
          exceptionF1: card.exceptionF1,
          valueCoveragePct: card.valueCoveragePct,
          passes: gate(card).length === 0,
        };
      });
    }
    res.set("Cache-Control", "public, max-age=600").json({ curve: curveCache, thresholds: THRESHOLDS });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /v1/runs/:id/agreement — did the humans agree with it?
 *
 * The report that decides whether shadow mode can end. A run in `observe`
 * reconciles everything and posts nothing, so the only evidence that its
 * judgement is sound is whether the people working the queue afterwards
 * reached the same conclusions it did.
 *
 * Agreement is measured per exception, on the one thing the engine committed
 * to: whether it believed the class could be cleared automatically.
 *
 *   engine said auto-resolvable + a person LINKED it   → agreed
 *   engine said auto-resolvable + a person WROTE IT OFF → the engine was wrong
 *   engine said escalate       + a person WROTE IT OFF → agreed
 *   engine said escalate       + a person LINKED it     → the engine was timid
 *
 * Timid and wrong are counted separately on purpose. Being too cautious costs
 * an hour of somebody's morning; being wrong costs money, and averaging the two
 * into one percentage hides exactly the number that matters.
 */
runsRouter.get("/v1/runs/:id/agreement", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, String(req.params.id)));
    if (!run) return res.status(404).json({ error: "no such run" });

    const rows = await db.select().from(exceptions).where(eq(exceptions.runId, run.id));
    const decided = rows.filter((e) => e.status !== "OPEN" && e.resolution);
    // "written off" is the wording reclass() writes; a link says "proven".
    const wroteOff = (r: string) => /written off/i.test(r);

    let agreedAuto = 0;
    let agreedEscalate = 0;
    let wrong = 0;
    let timid = 0;
    let valueWrongPaise = 0n;

    for (const e of decided) {
      const off = wroteOff(e.resolution ?? "");
      if (e.autoResolvable && !off) agreedAuto += 1;
      else if (e.autoResolvable && off) {
        wrong += 1;
        valueWrongPaise += e.amountPaise;
      } else if (!e.autoResolvable && off) agreedEscalate += 1;
      else timid += 1;
    }

    const agreed = agreedAuto + agreedEscalate;
    const policy = (run.stages as { policy?: Record<string, unknown> } | null)?.policy ?? null;

    res.json({
      runId: run.id,
      period: run.period,
      // Null rather than 0 when nothing has been worked yet: a 0% agreement
      // rate over zero decisions reads as a failure, and it is an absence.
      agreementPct: decided.length === 0 ? null : Math.round((agreed / decided.length) * 1000) / 10,
      decided: decided.length,
      open: rows.length - decided.length,
      agreedAuto,
      agreedEscalate,
      wrong,
      timid,
      valueWrongPaise,
      policy,
      note:
        decided.length === 0
          ? "Nobody has worked this queue yet, so there is nothing to agree with."
          : wrong === 0
            ? "No exception the engine would have cleared was written off by a person."
            : `${wrong} exceptions the engine would have cleared were written off instead — that is the number that has to be zero before autonomy widens.`,
    });
  } catch (e) {
    next(e);
  }
});
