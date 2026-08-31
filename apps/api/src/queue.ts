import { sql } from "drizzle-orm";
import type { db as Db } from "./db/index.ts";
import { jobs, type Job } from "./db/schema.ts";

/**
 * The queue. A table and one statement.
 *
 * The build plan calls for pg-boss, which would need Neon's UNPOOLED connection
 * because its LISTEN behaves unpredictably through the pooler — a second
 * connection string, a second failure mode, and a dependency, all to move one
 * row between two states. `FOR UPDATE SKIP LOCKED` inside a single UPDATE is
 * atomic on its own: two workers racing cannot claim the same job, and there is
 * no transaction to hold open over the HTTP driver.
 *
 * ponytail: polling at one-second idle. If runs ever arrive faster than a close
 * per minute, swap the poll for LISTEN/NOTIFY on the direct connection.
 */

/** A job whose lock is older than this is assumed dead and may be re-claimed. */
export const LOCK_TIMEOUT = "5 minutes";

export type Queue = NonNullable<typeof Db>;

/** Queue a close run. Unique on run id, so a retried POST enqueues once. */
export async function enqueue(db: Queue, runId: string, datasetId: string): Promise<void> {
  await db.insert(jobs).values({ runId, datasetId }).onConflictDoNothing();
}

/**
 * Claim the oldest runnable job for this worker, or null.
 *
 * A RUNNING job whose lock has expired is claimable again: that is exactly the
 * redeploy case, where the previous worker was SIGTERMed mid-run. It resumes
 * from `stage` rather than starting over.
 */
export type ClaimedJob = Pick<Job, "id" | "runId" | "datasetId" | "state" | "stage" | "attempts" | "lockedBy">;

export async function claim(db: Queue, workerId: string): Promise<ClaimedJob | null> {
  const { rows } = await db.execute<ClaimedJob>(sql`
    update jobs set
      state = 'RUNNING',
      locked_by = ${workerId},
      locked_at = now(),
      attempts = attempts + 1,
      updated_at = now()
    where id = (
      select id from jobs
      where state = 'QUEUED'
         or (state = 'RUNNING' and locked_at < now() - interval '${sql.raw(LOCK_TIMEOUT)}')
      order by created_at
      limit 1
      for update skip locked
    )
    -- db.execute returns RAW postgres rows, not Drizzle-mapped ones, so the
    -- columns have to be aliased by hand. A bare returning-star would hand
    -- back run_id and silently leave job.runId undefined.
    returning id, run_id as "runId", dataset_id as "datasetId", state, stage,
              attempts, locked_by as "lockedBy"
  `);
  return rows[0] ?? null;
}

/** Mark the last tier that was durably committed. Resume reads this. */
export async function checkpoint(db: Queue, jobId: string, stage: string): Promise<void> {
  await db.update(jobs).set({ stage, updatedAt: new Date() }).where(sql`id = ${jobId}`);
}

export async function finish(db: Queue, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ state: "DONE", lockedBy: null, error: null, updatedAt: new Date() })
    .where(sql`id = ${jobId}`);
}

/**
 * Fail a job, but only permanently after three attempts.
 *
 * Two of the three realistic failures here — a Neon cold start and a deploy
 * killing the process — are transient, and a run that gives up on the first one
 * is a run somebody has to babysit.
 */
export async function fail(db: Queue, job: ClaimedJob, err: unknown): Promise<void> {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  await db
    .update(jobs)
    .set({
      state: job.attempts >= 3 ? "FAILED" : "QUEUED",
      lockedBy: null,
      lockedAt: null,
      error: message.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(sql`id = ${job.id}`);
}
