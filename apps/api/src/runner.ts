import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import {
  bankLines,
  datasets,
  erpInvoices,
  exceptions,
  matchLinks,
  reconRows,
  runEvents,
  runs,
  settlements,
} from "./db/schema.ts";
import { log } from "./log.ts";
import { assertBalanced, postingsFor, type Posting } from "./ledger.ts";
import { proposeWithModel } from "./agent/propose.ts";
import {
  reconcileStaged,
  TIERS,
  type ReconRowIn,
  type ReconcileInput,
  type RunResult,
} from "./recon/engine.ts";

/**
 * Executing a close run, durably.
 *
 * The contract the phase plan sets is blunt: redeploy the worker mid-run, and
 * the job resumes from the last committed stage with an identical final count
 * and nothing posted twice. Two decisions get that for free.
 *
 * First, resume by REPLAY rather than by checkpointing state. The engine is
 * pure and a 5,000-row pass costs single-digit milliseconds, so re-running the
 * earlier tiers is cheaper than serialising their intermediate state — and,
 * unlike a checkpoint, replay cannot diverge from what the first attempt did.
 *
 * Second, make every write idempotent at the database rather than in a guard.
 * match_links, run_events and journal_entries each carry a unique key, and
 * every insert is ON CONFLICT DO NOTHING. Correctness then does not depend on
 * the worker knowing what it already did, which is exactly the thing a process
 * killed by SIGTERM cannot be trusted about.
 */

type Db = NonNullable<typeof db>;

/** seq 1..6 are the tiers; the finish event is always last and always the same. */
export const SEQ_FINISHED = TIERS.length + 1;

export type LoadedInputs = ReconcileInput & {
  rowsBySettlement: Map<string, ReconRowIn[]>;
  bankByRef: Map<string, { valueDate: string; creditPaise: bigint; chargesPaise: bigint }>;
};

/** Read one dataset in a stable order, so two runs over it are byte-identical. */
export async function loadInputs(database: Db, datasetId: string): Promise<LoadedInputs> {
  const [setls, rows, banks, invoices, [ds]] = await Promise.all([
    database.select().from(settlements).where(eq(settlements.datasetId, datasetId)).orderBy(asc(settlements.ref)),
    database.select().from(reconRows).where(eq(reconRows.datasetId, datasetId)).orderBy(asc(reconRows.entityId)),
    database.select().from(bankLines).where(eq(bankLines.datasetId, datasetId)).orderBy(asc(bankLines.ref)),
    database.select().from(erpInvoices).where(eq(erpInvoices.datasetId, datasetId)).orderBy(asc(erpInvoices.orderReceipt)),
    database.select().from(datasets).where(eq(datasets.id, datasetId)),
  ]);

  const mapped: ReconRowIn[] = rows.map((r) => ({
    entityId: r.entityId,
    settlementRef: r.settlementRef,
    type: r.type,
    orderId: r.orderId,
    creditPaise: r.creditPaise,
    debitPaise: r.debitPaise,
    feePaise: r.feePaise,
    taxPaise: r.taxPaise,
    disputeId: r.disputeId,
    capturedOn: r.capturedOn,
    currency: r.currency,
    description: r.description,
  }));

  const rowsBySettlement = new Map<string, ReconRowIn[]>();
  for (const r of mapped) {
    const k = r.settlementRef ?? "";
    const list = rowsBySettlement.get(k);
    if (list) list.push(r);
    else rowsBySettlement.set(k, [r]);
  }

  return {
    settlements: setls.map((s) => ({
      ref: s.ref,
      utr: s.utr,
      amountPaise: s.amountPaise,
      settledOn: s.settledOn,
      onHold: s.onHold,
    })),
    reconRows: mapped,
    bankLines: banks.map((b) => ({
      ref: b.ref,
      valueDate: b.valueDate,
      creditPaise: b.creditPaise,
      chargesPaise: b.chargesPaise,
      narration: b.narration,
    })),
    erpInvoices: invoices.map((i) => ({ orderReceipt: i.orderReceipt, amountPaise: i.amountPaise })),
    period: ds?.period ?? "2026-06",
    rowsBySettlement,
    bankByRef: new Map(banks.map((b) => [b.ref, b])),
  };
}

const BATCH = 1000;

/**
 * Write one entry and its lines in a single statement.
 *
 * Neon's HTTP driver has no interactive transaction, so the entry and its lines
 * cannot be two round trips: a crash between them would leave a header with no
 * lines, which is an unbalanced journal that passed the balance check. A CTE
 * makes it one statement and therefore one implicit transaction. If the entry
 * conflicts on its idempotency key, the CTE returns no row and no lines are
 * written either — the whole posting is a no-op rather than half of one.
 */
export async function postEntry(
  database: Db,
  meta: { tenantId: string; runId: string; period: string; createdBy?: string | null },
  p: Posting,
): Promise<void> {
  const lines = p.lines.map((l) => ({
    account: l.account,
    debit_paise: l.debitPaise.toString(),
    credit_paise: l.creditPaise.toString(),
    memo: l.memo,
    source_type: l.sourceType ?? p.sourceType,
    source_ref: l.sourceRef ?? p.sourceRef,
  }));

  await database.execute(sql`
    with e as (
      insert into journal_entries
        (tenant_id, run_id, entry_date, period, memo, source_type, source_ref, created_by)
      values (${meta.tenantId}, ${meta.runId}, ${p.entryDate}, ${meta.period},
              ${p.memo}, ${p.sourceType}, ${p.sourceRef}, ${meta.createdBy ?? null})
      on conflict (tenant_id, source_type, source_ref) do nothing
      returning id
    )
    insert into journal_lines
      (entry_id, account, debit_paise, credit_paise, memo, source_type, source_ref)
    select e.id, x.account, x.debit_paise::bigint, x.credit_paise::bigint,
           x.memo, x.source_type, x.source_ref
    from e, jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) as x(
      account text, debit_paise text, credit_paise text,
      memo text, source_type text, source_ref text
    )
  `);
}

/** Emit a progress event. Same seq on replay, so Last-Event-ID keeps its meaning. */
async function emit(
  database: Db,
  runId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await database.insert(runEvents).values({ runId, seq, type, payload }).onConflictDoNothing();
}

export type ExecuteOptions = {
  /** Called after each tier commits, so the worker can checkpoint its job row. */
  onStage?: (tier: string) => Promise<void>;
};

/**
 * Run one close, committing after every tier.
 *
 * The generator is what makes this possible: the engine yields at each tier
 * boundary with the links it just produced, and this function is the only place
 * that knows about a database. The engine itself still cannot do IO.
 */
export async function executeRun(
  database: Db,
  runId: string,
  datasetId: string,
  opts: ExecuteOptions = {},
): Promise<RunResult> {
  const input = await loadInputs(database, datasetId);
  const [run] = await database.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error(`no such run ${runId}`);

  await database
    .update(runs)
    .set({ state: "RUNNING", startedAt: run.startedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(runs.id, runId));

  // T5 claims are fetched up front and handed to the engine as data. That keeps
  // reconcile() pure and, more importantly, keeps a replay free: the model is
  // never called twice for the same prompt.
  const agent = await proposeWithModel(database, runId, input);

  const it = reconcileStaged({ ...input, proposals: agent.proposals });
  let step = it.next();
  let index = 0;
  while (!step.done) {
    const { stage, links } = step.value;

    if (links.length > 0) {
      const values = links.map((l) => ({
        runId,
        datasetId,
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
      for (let i = 0; i < values.length; i += BATCH) {
        await database.insert(matchLinks).values(values.slice(i, i + BATCH)).onConflictDoNothing();
      }
    }

    index += 1;
    await emit(database, runId, index, "stage", {
      ...stage,
      links: stage.links,
      committed: links.length,
    });
    await database
      .update(runs)
      .set({ state: `RUNNING:${stage.key}`, updatedAt: new Date() })
      .where(eq(runs.id, runId));
    await opts.onStage?.(stage.key);

    step = it.next();
  }

  const result = step.value;

  // --- exceptions --------------------------------------------------------------
  // DO NOTHING rather than an upsert: a resumed run must never reopen an
  // exception a person already resolved.
  if (result.exceptions.length > 0) {
    const values = result.exceptions.map((e) => ({
      runId,
      datasetId,
      tenantId: run.tenantId,
      code: e.code,
      subjectType: e.subjectType,
      subjectRef: e.subjectRef,
      amountPaise: e.amountPaise,
      parksTo: e.parksTo,
      autoResolvable: e.autoResolvable,
      reason: e.reason,
      asOf: e.asOf,
      evidence: e.evidence,
    }));
    for (let i = 0; i < values.length; i += BATCH) {
      await database.insert(exceptions).values(values.slice(i, i + BATCH)).onConflictDoNothing();
    }
  }

  // --- the ledger --------------------------------------------------------------
  const postings = postingsFor({
    result,
    rowsBySettlement: input.rowsBySettlement,
    bankLines: input.bankByRef,
    entryDate: `${input.period ?? run.period}-01`,
  });
  assertBalanced(postings); // nothing partial posts: the whole batch or none
  for (const p of postings) {
    await postEntry(database, { tenantId: run.tenantId, runId, period: run.period }, p);
  }

  const finished = new Date();
  await database
    .update(runs)
    .set({
      state: "SCORED",
      totalRows: BigInt(result.totalRows),
      matchedRows: BigInt(result.matchedRows),
      unprovenPaise: result.unprovenPaise,
      // The settlement detail lives on the run so /runs/:id is one read, and so
      // the figures a page shows cannot drift from the run that produced them.
      stages: {
        tiers: result.stages,
        autoMatchPct: result.autoMatchPct,
        // The agent's own words, kept beside the verifier's verdict rather than
        // in place of it. A claim nobody proved is still worth showing.
        agent: { notes: agent.notes, usage: agent.usage },
        heldPaise: result.heldPaise.toString(),
        absorbedPaise: result.absorbedPaise.toString(),
        judged: result.judged.map((j) => ({
          bankRef: j.proposal.bankRef,
          settlementRefs: j.proposal.settlementRefs,
          basis: j.proposal.basis,
          source: j.proposal.source,
          claim: j.proposal.claim ?? null,
          model: j.proposal.model ?? null,
          verdict: j.verdict.verdict,
          reason: j.verdict.reason,
          proposerDeltaPaise: j.verdict.proposerDeltaPaise.toString(),
        })),
        settlements: result.settlements.map((s) => ({
          ...s,
          amountPaise: s.amountPaise.toString(),
          deltaPaise: s.deltaPaise.toString(),
          absorbedPaise: s.absorbedPaise.toString(),
        })),
      },
      finishedAt: finished,
      updatedAt: finished,
    })
    .where(eq(runs.id, runId));

  await emit(database, runId, SEQ_FINISHED, "finished", {
    matchedRows: result.matchedRows,
    totalRows: result.totalRows,
    autoMatchPct: result.autoMatchPct,
    exceptions: result.exceptions.length,
    entries: postings.length,
  });

  log.info(
    { runId, matched: result.matchedRows, total: result.totalRows, entries: postings.length },
    "run finished",
  );
  return result;
}

/** Mark a run failed and say so on the stream, rather than leaving it RUNNING forever. */
export async function failRun(database: Db, runId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  await database
    .update(runs)
    .set({ state: "FAILED", updatedAt: new Date() })
    .where(eq(runs.id, runId));
  await emit(database, runId, SEQ_FINISHED, "failed", { error: message.slice(0, 500) });
}

