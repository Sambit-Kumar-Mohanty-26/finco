import { Router } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { EXCEPTION_SPECS, SUSPENSE, type ExceptionCode } from "@finco/core";
import { db } from "../db/index.ts";
import { exceptions, journalEntries, matchLinks, runs } from "../db/schema.ts";
import { attachActor, requireRole } from "../auth.ts";
import { loadInputs, postEntry } from "../runner.ts";
import { verifyOne, type Proposal } from "../recon/engine.ts";
import { scoped } from "../policy.ts";

export const exceptionsRouter = Router();
exceptionsRouter.use(attachActor);

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * GET /v1/exceptions — the queue, with facet counts.
 *
 * The counts come back for the WHOLE run, not for the filtered page: a facet
 * that only counts what is already on screen tells you nothing you cannot see,
 * and reads zero when you have filtered it out. That is the difference between
 * a filter UI and a decoration.
 */
exceptionsRouter.get("/v1/exceptions", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const runId = String(req.query.runId ?? "");
    if (!runId) return res.status(400).json({ error: "runId is required" });

    const codes = String(req.query.code ?? "").split(",").filter(Boolean);
    const status = String(req.query.status ?? "OPEN");
    const cursor = String(req.query.cursor ?? "");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));

    const filters = [eq(exceptions.runId, runId)];
    if (status !== "ALL") filters.push(eq(exceptions.status, status));
    if (codes.length > 0) filters.push(inArray(exceptions.code, codes));
    // Keyset, not OFFSET: page 40 of an offset scan re-reads the first 39.
    if (cursor) filters.push(sql`${exceptions.id} > ${cursor}`);

    const [rows, facets, statuses] = await Promise.all([
      db
        .select()
        .from(exceptions)
        .where(and(...filters))
        .orderBy(asc(exceptions.id))
        .limit(limit + 1),
      db
        .select({
          code: exceptions.code,
          n: sql<number>`count(*)::int`,
          valuePaise: sql<bigint>`coalesce(sum(${exceptions.amountPaise}), 0)`,
        })
        .from(exceptions)
        .where(
          and(
            eq(exceptions.runId, runId),
            status === "ALL" ? undefined : eq(exceptions.status, status),
          ),
        )
        .groupBy(exceptions.code)
        .orderBy(asc(exceptions.code)),
      db
        .select({ status: exceptions.status, n: sql<number>`count(*)::int` })
        .from(exceptions)
        .where(eq(exceptions.runId, runId))
        .groupBy(exceptions.status),
    ]);

    const page = rows.slice(0, limit);
    res.json({
      exceptions: page.map((e) => ({ ...e, spec: EXCEPTION_SPECS[e.code as ExceptionCode] ?? null })),
      facets: facets.map((f) => ({
        ...f,
        label: EXCEPTION_SPECS[f.code as ExceptionCode]?.label ?? f.code,
        owner: EXCEPTION_SPECS[f.code as ExceptionCode]?.owner ?? "Ops",
      })),
      statuses,
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    });
  } catch (e) {
    next(e);
  }
});

exceptionsRouter.get("/v1/exceptions/:id", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [row] = await db.select().from(exceptions).where(eq(exceptions.id, String(req.params.id)));
    if (!row) return res.status(404).json({ error: "no such exception" });
    // The evidence panel needs the links that touch the same subject, so a
    // reviewer sees what the engine already tried and exactly why it refused.
    const related = await db
      .select()
      .from(matchLinks)
      .where(
        and(
          eq(matchLinks.runId, row.runId),
          sql`(${matchLinks.leftRef} = ${row.subjectRef} or ${matchLinks.rightRef} like ${"%" + row.subjectRef + "%"})`,
        ),
      )
      .limit(50);
    res.json({ ...row, spec: EXCEPTION_SPECS[row.code as ExceptionCode] ?? null, related });
  } catch (e) {
    next(e);
  }
});

type Resolution =
  | { action: "link"; bankRef: string; settlementRefs: string[]; expectedSumPaise: string }
  | { action: "writeoff"; account: string; note: string };

/**
 * Post the ledger half of a resolution.
 *
 * An exception is money sitting in a park account. Resolving it therefore has
 * to MOVE that money, or the queue empties while the trial balance stays wrong
 * — the failure mode of every recon tool that treats an exception as a task
 * rather than as a balance.
 */
async function reclass(
  tenantId: string,
  runId: string,
  period: string,
  ex: typeof exceptions.$inferSelect,
  toAccount: string,
  memo: string,
  actorId: string,
): Promise<void> {
  if (!db || ex.amountPaise === 0n) return;
  const from = ex.parksTo || SUSPENSE;
  const amount = ex.amountPaise;
  await postEntry(
    db,
    { tenantId, runId, period, createdBy: actorId },
    {
      sourceType: "settlement_suspense",
      sourceRef: `resolve:${ex.id}`,
      entryDate: ex.asOf ?? `${period}-01`,
      memo,
      lines:
        amount >= 0n
          ? [
              { account: toAccount, debitPaise: amount, creditPaise: 0n, memo },
              { account: from, debitPaise: 0n, creditPaise: amount, memo },
            ]
          : [
              { account: from, debitPaise: -amount, creditPaise: 0n, memo },
              { account: toAccount, debitPaise: 0n, creditPaise: -amount, memo },
            ],
    },
  );
}

/**
 * POST /v1/exceptions/:id/resolve
 *
 * A person proposing a link goes through the SAME verifier a model does. There
 * is no human override that skips the identity check: if the numbers do not
 * close the answer is 422 with the arithmetic, and the honest resolution is a
 * write-off, which an approver signs and which lands in the ledger under their
 * name. "Trust me" is not a posting basis.
 */
exceptionsRouter.post("/v1/exceptions/:id/resolve", requireRole("preparer"), async (req, res, next) => {
  if (!db) return needDb(res);
  const actor = req.actor!;
  try {
    const [ex] = await db.select().from(exceptions).where(eq(exceptions.id, String(req.params.id)));
    // Same 404 for "does not exist" and "not yours": a different status here
    // would confirm the id belongs to another tenant.
    if (!ex || ex.tenantId !== actor.tenantId) return res.status(404).json({ error: "no such exception" });
    if (ex.status !== "OPEN") return res.status(409).json({ error: `already ${ex.status}` });

    const [run] = await db.select().from(runs).where(eq(runs.id, ex.runId));
    if (!run) return res.status(404).json({ error: "no such run" });

    const body = req.body as Resolution;

    if (body?.action === "link") {
      const input = await loadInputs(db, ex.datasetId);
      const p: Proposal = {
        bankRef: String(body.bankRef ?? ""),
        settlementRefs: (body.settlementRefs ?? []).map(String),
        basis: "amount_subset",
        expectedSumPaise: BigInt(String(body.expectedSumPaise ?? "0")),
        source: "T5",
        claim: `resolved by ${actor.email}`,
      };
      const v = verifyOne(input, p);
      if (v.verdict !== "ACCEPT") {
        return res.status(422).json({
          error: "the verifier does not agree",
          verdict: v.verdict,
          reason: v.reason,
          deltaPaise: v.deltaPaise.toString(),
        });
      }
      await db
        .insert(matchLinks)
        .values({
          runId: ex.runId,
          datasetId: ex.datasetId,
          tier: "MANUAL",
          verdict: "PROVEN",
          leftType: "bank_line",
          leftRef: p.bankRef,
          rightType: "settlement",
          rightRef: p.settlementRefs.join(","),
          amountPaise: ex.amountPaise,
          deltaPaise: v.deltaPaise,
          reason: `${actor.email}: ${v.reason}`,
        })
        .onConflictDoNothing();
      await reclass(actor.tenantId, ex.runId, run.period, ex, "1010", `${ex.code} proven against ${p.bankRef}`, actor.id);
    } else if (body?.action === "writeoff") {
      // A write-off is a loss somebody owns, so it needs the approver role and
      // a reason. An unexplained write-off is suspense with better PR.
      if (actor.role !== "approver") {
        return res.status(403).json({ error: "a write-off needs the approver role" });
      }
      if (!String(body.note ?? "").trim()) {
        return res.status(400).json({ error: "a write-off needs a reason" });
      }
      await reclass(
        actor.tenantId,
        ex.runId,
        run.period,
        ex,
        String(body.account ?? "5290"),
        `${ex.code} written off: ${body.note}`,
        actor.id,
      );
    } else {
      return res.status(400).json({ error: "action must be 'link' or 'writeoff'" });
    }

    // The status filter in the WHERE is the concurrency check: two reviewers
    // clicking at once, only one of them resolves it.
    const [updated] = await db
      .update(exceptions)
      .set({
        status: "RESOLVED",
        resolution: JSON.stringify(body).slice(0, 1000),
        resolvedBy: actor.id,
        resolvedAt: new Date(),
      })
      .where(and(eq(exceptions.id, ex.id), eq(exceptions.status, "OPEN")))
      .returning();
    if (!updated) return res.status(409).json({ error: "somebody resolved this first" });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/exceptions/:id/reopen — the undo behind the ten-second toast.
 *
 * Append-only means undo is a REVERSAL, not a delete. The original entry stays
 * in the journal with its mirror beside it, because an audit trail that can
 * lose a row is not an audit trail.
 */
exceptionsRouter.post("/v1/exceptions/:id/reopen", requireRole("preparer"), async (req, res, next) => {
  if (!db) return needDb(res);
  const actor = req.actor!;
  try {
    const [ex] = await db.select().from(exceptions).where(eq(exceptions.id, String(req.params.id)));
    if (!ex || ex.tenantId !== actor.tenantId) return res.status(404).json({ error: "no such exception" });
    if (ex.status !== "RESOLVED") return res.status(409).json({ error: `cannot reopen a ${ex.status} exception` });

    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(scoped(journalEntries, actor.tenantId, eq(journalEntries.sourceRef, `resolve:${ex.id}`)));

    if (entry) {
      const lines = await db.execute<{ account: string; debit_paise: bigint; credit_paise: bigint }>(
        sql`select account, debit_paise, credit_paise from journal_lines where entry_id = ${entry.id}`,
      );
      await postEntry(
        db,
        { tenantId: actor.tenantId, runId: ex.runId, period: entry.period, createdBy: actor.id },
        {
          sourceType: "settlement_suspense",
          sourceRef: `reverse:${ex.id}`,
          entryDate: entry.entryDate,
          memo: `Reversal of ${ex.code} resolution, undone by ${actor.email}`,
          // Sides swapped: a reversal is the mirror, never a negative amount.
          lines: lines.rows.map((l) => ({
            account: l.account,
            debitPaise: BigInt(l.credit_paise),
            creditPaise: BigInt(l.debit_paise),
            memo: "reversal",
          })),
        },
      );
      await db
        .update(journalEntries)
        .set({ reversalOf: entry.id })
        .where(scoped(journalEntries, actor.tenantId, eq(journalEntries.sourceRef, `reverse:${ex.id}`)));
    }

    const [updated] = await db
      .update(exceptions)
      .set({ status: "OPEN", resolution: null, resolvedBy: null, resolvedAt: null })
      .where(and(eq(exceptions.id, ex.id), eq(exceptions.status, "RESOLVED")))
      .returning();
    res.json(updated ?? { id: ex.id, status: "OPEN" });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/exceptions/bulk-approve — body { ids: string[] }.
 *
 * Homogeneity is enforced, not suggested: a bulk action over a mixed selection
 * is how somebody approves eleven fee-rounding drifts and, without noticing, a
 * dispute. Each refusal names the SPECIFIC reason so the UI can say why the
 * button is unavailable instead of greying it out silently.
 */
exceptionsRouter.post("/v1/exceptions/bulk-approve", requireRole("approver"), async (req, res, next) => {
  if (!db) return needDb(res);
  const actor = req.actor!;
  try {
    const ids: string[] = (req.body?.ids ?? []).map(String).slice(0, 500);
    if (ids.length === 0) return res.status(400).json({ error: "select something first" });

    const rows = await db.select().from(exceptions).where(inArray(exceptions.id, ids));
    if (rows.length !== ids.length || rows.some((r) => r.tenantId !== actor.tenantId)) {
      return res.status(404).json({ error: "some of those no longer exist" });
    }

    const codes = [...new Set(rows.map((r) => r.code))];
    if (codes.length > 1) {
      return res.status(422).json({
        error: "a bulk approval must be one exception class",
        reason: `the selection mixes ${codes.join(", ")}; approve one class at a time`,
        codes,
      });
    }
    const code = codes[0] as ExceptionCode;
    const spec = EXCEPTION_SPECS[code];

    const notOpen = rows.filter((r) => r.status !== "OPEN");
    if (notOpen.length > 0) {
      return res.status(409).json({
        error: "some are no longer open",
        reason: `${notOpen.length} of ${rows.length} were resolved by somebody else while you were choosing`,
      });
    }
    if (rows.some((r) => !r.autoResolvable)) {
      return res.status(422).json({
        error: "this class cannot be approved in bulk",
        reason: `${code} needs a decision per item — ${spec?.playbook.join("; ") ?? "no playbook"}`,
      });
    }

    const [run] = await db.select().from(runs).where(eq(runs.id, rows[0]!.runId));
    const period = run?.period ?? rows[0]!.asOf?.slice(0, 7) ?? "2026-06";
    const account = spec?.parksTo ?? SUSPENSE;
    for (const ex of rows) {
      await reclass(actor.tenantId, ex.runId, period, ex, account, `${ex.code} bulk-approved by ${actor.email}`, actor.id);
    }

    const updated = await db
      .update(exceptions)
      .set({
        status: "RESOLVED",
        resolution: `bulk-approved by ${actor.email}`,
        resolvedBy: actor.id,
        resolvedAt: new Date(),
      })
      .where(and(inArray(exceptions.id, ids), eq(exceptions.status, "OPEN")))
      .returning({ id: exceptions.id });

    res.json({ resolved: updated.length, code, account });
  } catch (e) {
    next(e);
  }
});
