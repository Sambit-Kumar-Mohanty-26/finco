import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { ageing, floorCheck, fitPropensity, forecast } from "@finco/core";
import { db } from "../db/index.ts";
import { datasets, reconRows } from "../db/schema.ts";
import { readPolicy, scoped, tenantOf } from "../policy.ts";

export const cashRouter = Router();

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * GET /v1/cash/forecast — the fortnight curve and the ageing buckets.
 *
 * The forecast itself is pure and lives in @finco/core. This route is the thin
 * part: find the rows, read the floor from the tenant's policy, and cache.
 *
 * CACHED FOR 15 MINUTES, and the cache is served STALE while it refreshes. The
 * cash page is the one somebody opens on a phone between meetings, and a page
 * that waits three seconds on a cold read to show a number that barely moves in
 * a quarter of an hour is worse than a page that shows the number and says how
 * old it is. The staleness is on screen, not hidden — an unlabelled cached
 * number is how a stale figure ends up in a board pack.
 */

const TTL_MS = 15 * 60 * 1000;
type Entry = { at: number; body: Record<string, unknown> };
const cache = new Map<string, Entry>();
const refreshing = new Set<string>();

/** Today in IST. The books are Indian; UTC would roll the day over at 05:30. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function build(tenantId: string, datasetId: string | null, days: number) {
  const database = db!;
  const [ds] = datasetId
    ? await database
        .select()
        .from(datasets)
        .where(scoped(datasets, tenantId, eq(datasets.id, datasetId)))
    : await database
        .select()
        .from(datasets)
        .where(scoped(datasets, tenantId))
        .orderBy(desc(datasets.createdAt))
        .limit(1);
  if (!ds) return null;

  const rows = await database.select().from(reconRows).where(eq(reconRows.datasetId, ds.id));
  const policy = await readPolicy(tenantId);
  const asOf = istToday();

  const curve = forecast(rows, asOf, days);
  const buckets = ageing(rows, asOf);
  const floor = floorCheck(curve, policy.cashFloorPaise);
  const domestic = fitPropensity(rows, false);
  const international = fitPropensity(rows, true);

  return {
    datasetId: ds.id,
    datasetName: ds.name,
    period: ds.period,
    asOf,
    days,
    curve,
    buckets,
    floor,
    // The fit is published, not hidden. A forecast whose assumptions are not
    // visible cannot be argued with, and one that cannot be argued with does
    // not get trusted with a payment decision.
    propensity: { domestic, international },
    unprovenPaise: buckets.filter((b) => b.overdue).reduce((a, b) => a + b.valuePaise, 0n),
  };
}

cashRouter.get("/v1/cash/forecast", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const datasetId = typeof req.query.datasetId === "string" ? req.query.datasetId : null;
    const days = Math.min(60, Math.max(1, Number(req.query.days ?? 14)));
    const key = `${tenantId}:${datasetId ?? "latest"}:${days}`;

    const hit = cache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;

    if (hit && age < TTL_MS) {
      return res.set("Cache-Control", "private, max-age=60").json({ ...hit.body, cachedAgeMs: age, stale: false });
    }

    // Stale-while-revalidate, by hand. One refresh in flight per key: a burst of
    // requests against a cold cache must not become a burst of full table scans.
    if (hit) {
      if (!refreshing.has(key)) {
        refreshing.add(key);
        void build(tenantId, datasetId, days)
          .then((fresh) => {
            if (fresh) cache.set(key, { at: Date.now(), body: fresh });
          })
          .catch(() => {
            /* keep serving the stale copy rather than emptying the cache */
          })
          .finally(() => refreshing.delete(key));
      }
      return res.set("Cache-Control", "private, max-age=60").json({ ...hit.body, cachedAgeMs: age, stale: true });
    }

    const fresh = await build(tenantId, datasetId, days);
    if (!fresh) return res.status(404).json({ error: "no dataset to forecast — seed or upload one first" });
    cache.set(key, { at: Date.now(), body: fresh });
    res.set("Cache-Control", "private, max-age=60").json({ ...fresh, cachedAgeMs: 0, stale: false });
  } catch (e) {
    next(e);
  }
});
