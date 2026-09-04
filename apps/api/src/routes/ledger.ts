import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { ACCOUNTS, SUSPENSE } from "@finco/core";
import { db } from "../db/index.ts";
import { journalEntries } from "../db/schema.ts";
import { scoped, tenantOf } from "../policy.ts";

export const ledgerRouter = Router();

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * GET /v1/ledger/trial-balance — the one number that says whether the close worked.
 *
 * Aggregated in Postgres rather than in Node: the sum of a million lines is a
 * single int8 there, and pulling them across to add up in JavaScript is both
 * slower and an invitation to lose precision on the way.
 *
 * `balanced` is computed, not assumed. If it is ever false, something wrote to
 * journal_lines outside postEntry, and that is the bug worth being loud about.
 */
ledgerRouter.get("/v1/ledger/trial-balance", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const runId = String(req.query.runId ?? "");
    const period = String(req.query.period ?? "");

    const rows = await db
      .select({
        account: sql<string>`l.account`,
        debitPaise: sql<bigint>`sum(l.debit_paise)`,
        creditPaise: sql<bigint>`sum(l.credit_paise)`,
        lines: sql<number>`count(*)::int`,
      })
      .from(sql`journal_lines l join journal_entries e on e.id = l.entry_id`)
      .where(
        and(
          sql`e.tenant_id = ${tenantId}`,
          runId ? sql`e.run_id = ${runId}` : undefined,
          period ? sql`e.period = ${period}` : undefined,
        ),
      )
      .groupBy(sql`l.account`)
      .orderBy(sql`l.account`);

    let debits = 0n;
    let credits = 0n;
    const accounts = rows.map((r) => {
      debits += r.debitPaise;
      credits += r.creditPaise;
      const net = r.debitPaise - r.creditPaise;
      const spec = ACCOUNTS.find((a) => a.code === r.account);
      return {
        account: r.account,
        name: spec?.name ?? "unmapped",
        type: spec?.type ?? "asset",
        debitPaise: r.debitPaise,
        creditPaise: r.creditPaise,
        netPaise: net,
        lines: r.lines,
      };
    });

    const suspense = accounts.find((a) => a.account === SUSPENSE);
    res.json({
      accounts,
      totals: { debitPaise: debits, creditPaise: credits, deltaPaise: debits - credits },
      balanced: debits === credits,
      // Broken out on purpose. Suspense is the headline of a close: a trial
      // balance that ties while 9999 holds lakhs is arithmetic, not a result.
      suspense: {
        account: SUSPENSE,
        netPaise: suspense?.netPaise ?? 0n,
        lines: suspense?.lines ?? 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** GET /v1/ledger/entries — the journal itself, keyset-paginated. */
ledgerRouter.get("/v1/ledger/entries", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const runId = String(req.query.runId ?? "");
    const account = String(req.query.account ?? "");
    const cursor = String(req.query.cursor ?? "");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));

    const rows = await db
      .select({
        id: journalEntries.id,
        entryDate: journalEntries.entryDate,
        period: journalEntries.period,
        memo: journalEntries.memo,
        sourceType: journalEntries.sourceType,
        sourceRef: journalEntries.sourceRef,
        reversalOf: journalEntries.reversalOf,
        createdAt: journalEntries.createdAt,
        lines: sql<
          { account: string; debitPaise: string; creditPaise: string; memo: string }[]
        >`(
          select coalesce(json_agg(json_build_object(
            'account', l.account,
            'debitPaise', l.debit_paise::text,
            'creditPaise', l.credit_paise::text,
            'memo', l.memo
          ) order by l.account), '[]'::json)
          from journal_lines l where l.entry_id = ${journalEntries.id}
        )`,
      })
      .from(journalEntries)
      .where(
        and(
          scoped(journalEntries, tenantId),
          runId ? eq(journalEntries.runId, runId) : undefined,
          cursor ? sql`${journalEntries.id} > ${cursor}` : undefined,
          // Filtering by account still returns the WHOLE entry: half of a
          // double entry is not a thing anybody can read.
          account
            ? sql`exists (select 1 from journal_lines l where l.entry_id = ${journalEntries.id} and l.account = ${account})`
            : undefined,
        ),
      )
      .orderBy(journalEntries.id)
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    res.json({ entries: page, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null });
  } catch (e) {
    next(e);
  }
});
