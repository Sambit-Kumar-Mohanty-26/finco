import { Router } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { datasets, exceptions, periods, runs } from "../db/schema.ts";
import { requireRole } from "../auth.ts";
import { audit, scoped, tenantOf } from "../policy.ts";

export const periodsRouter = Router();

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * The close checklist.
 *
 * Each item is COMPUTED, not ticked by hand. A checklist a person can tick
 * without the underlying thing being true is a formality, and formalities are
 * what get signed off at 7pm on the last day of the month. The only manual step
 * is the lock itself, which is a decision rather than a fact.
 */
export const CHECKS = [
  {
    key: "run_scored",
    label: "A close run has completed for this period",
    why: "Nothing else in the list means anything without one.",
  },
  {
    key: "identity_closure",
    label: "Every settlement closes against its own rows",
    why: "An identity break is a data problem upstream; posting around it moves the error into the ledger.",
  },
  {
    key: "exceptions_clear",
    label: "No open exceptions",
    why: "An open exception is money sitting in suspense that belongs somewhere else.",
  },
  {
    key: "ledger_balances",
    label: "Debits equal credits",
    why: "Checked inside every insert, and again here, because the one time it matters is the one time nobody checked.",
  },
  {
    key: "suspense_empty",
    label: "Suspense 9999 is zero",
    why: "Suspense is a waiting room, not an account. A balance here is unfinished work.",
  },
] as const;

async function evaluate(tenantId: string, period: string) {
  const database = db!;

  const [run] = await database
    .select()
    .from(runs)
    .where(scoped(runs, tenantId, eq(runs.period, period), eq(runs.state, "SCORED")))
    .orderBy(desc(runs.createdAt))
    .limit(1);

  const [openExc] = await database
    .select({ n: count() })
    .from(exceptions)
    .where(scoped(exceptions, tenantId, eq(exceptions.status, "OPEN")));

  // Lines carry no tenant of their own, so the tenant comes off the entry they
  // belong to. Summing journal_lines alone would total EVERY tenant's books and
  // fail this tenant's close over somebody else's suspense balance.
  const [sums] = await database
    .select({
      debit: sql<string>`coalesce(sum(l.debit_paise), 0)`,
      credit: sql<string>`coalesce(sum(l.credit_paise), 0)`,
    })
    .from(sql`journal_lines l join journal_entries e on e.id = l.entry_id`)
    .where(sql`e.tenant_id = ${tenantId}`);

  const [suspense] = await database
    .select({
      debit: sql<string>`coalesce(sum(l.debit_paise), 0)`,
      credit: sql<string>`coalesce(sum(l.credit_paise), 0)`,
    })
    .from(sql`journal_lines l join journal_entries e on e.id = l.entry_id`)
    .where(sql`e.tenant_id = ${tenantId} and l.account like '9999%'`);

  const unproven = run?.unprovenPaise ?? 0n;
  const openCount = Number(openExc?.n ?? 0);
  const drift = BigInt(sums?.debit ?? "0") - BigInt(sums?.credit ?? "0");
  const suspenseBalance = BigInt(suspense?.debit ?? "0") - BigInt(suspense?.credit ?? "0");

  const results: Record<string, { pass: boolean; detail: string }> = {
    run_scored: {
      pass: Boolean(run),
      detail: run
        ? `run ${run.id.slice(0, 8)} matched ${run.matchedRows} of ${run.totalRows}`
        : "no scored run for this period",
    },
    identity_closure: {
      pass: Boolean(run) && unproven === 0n,
      detail: run ? `${unproven} paise unproven` : "no run to measure",
    },
    exceptions_clear: {
      pass: openCount === 0,
      detail: openCount === 0 ? "none open" : `${openCount} still open`,
    },
    ledger_balances: {
      pass: drift === 0n,
      detail: drift === 0n ? "debits equal credits" : `out by ${drift} paise`,
    },
    suspense_empty: {
      pass: suspenseBalance === 0n,
      detail: suspenseBalance === 0n ? "empty" : `${suspenseBalance} paise held`,
    },
  };

  return {
    items: CHECKS.map((c) => ({ ...c, ...results[c.key]! })),
    ready: CHECKS.every((c) => results[c.key]!.pass),
    runId: run?.id ?? null,
  };
}

/** GET /v1/periods — every period with data, newest first, with its state. */
periodsRouter.get("/v1/periods", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const known = await db
      .selectDistinct({ period: datasets.period })
      .from(datasets)
      .where(scoped(datasets, tenantId));
    const locked = await db.select().from(periods).where(scoped(periods, tenantId));
    const byPeriod = new Map(locked.map((p) => [p.period, p]));

    const list = [...new Set([...known.map((k) => k.period), ...locked.map((l) => l.period)])]
      .sort()
      .reverse()
      .map((period) => ({
        period,
        state: byPeriod.get(period)?.state ?? "OPEN",
        lockedAt: byPeriod.get(period)?.lockedAt?.toISOString() ?? null,
        lockedBy: byPeriod.get(period)?.lockedBy ?? null,
      }));
    res.json({ periods: list });
  } catch (e) {
    next(e);
  }
});

/** GET /v1/periods/:period — the checklist, evaluated now. */
periodsRouter.get("/v1/periods/:period", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const period = String(req.params.period);
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be YYYY-MM" });

    const [row] = await db
      .select()
      .from(periods)
      .where(scoped(periods, tenantId, eq(periods.period, period)));
    const evaluated = await evaluate(tenantId, period);

    res.json({
      period,
      state: row?.state ?? "OPEN",
      lockedAt: row?.lockedAt?.toISOString() ?? null,
      lockedBy: row?.lockedBy ?? null,
      ...evaluated,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/periods/:period/lock — close the books.
 *
 * Refuses when the checklist does not pass, and names the item that failed. A
 * lock you can force past a failing check is not a control; it is a button.
 */
periodsRouter.post("/v1/periods/:period/lock", requireRole("approver"), async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const period = String(req.params.period);
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be YYYY-MM" });

    const evaluated = await evaluate(tenantId, period);
    if (!evaluated.ready) {
      const failed = evaluated.items.filter((i) => !i.pass);
      return res.status(422).json({
        error: "the checklist does not pass",
        failed: failed.map((f) => ({ key: f.key, label: f.label, detail: f.detail })),
      });
    }

    const checklist = Object.fromEntries(
      evaluated.items.map((i) => [i.key, { at: new Date().toISOString(), by: req.actor?.email ?? "" }]),
    );
    const values = {
      tenantId,
      period,
      state: "LOCKED",
      checklist,
      lockedAt: new Date(),
      lockedBy: req.actor?.email ?? "",
    };
    await db.insert(periods).values(values).onConflictDoUpdate({ target: [periods.tenantId, periods.period], set: values });
    await audit(req.actor, "period.lock", { type: "period", ref: period }, { runId: evaluated.runId });

    res.json({ period, state: "LOCKED", lockedBy: values.lockedBy, lockedAt: values.lockedAt.toISOString() });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/periods/:period/reopen — undo the lock.
 *
 * Kept deliberately: a lock nobody can reverse gets worked around by posting
 * into the wrong month, which is a worse outcome than a reopen with a name on
 * it. Audited, and it requires a reason.
 */
periodsRouter.post("/v1/periods/:period/reopen", requireRole("approver"), async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const period = String(req.params.period);
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 8) return res.status(400).json({ error: "say why, in a sentence a reviewer can read later" });

    await db
      .update(periods)
      .set({ state: "OPEN", lockedAt: null, lockedBy: "" })
      .where(scoped(periods, tenantId, eq(periods.period, period)));
    await audit(req.actor, "period.reopen", { type: "period", ref: period }, { reason });

    res.json({ period, state: "OPEN" });
  } catch (e) {
    next(e);
  }
});
