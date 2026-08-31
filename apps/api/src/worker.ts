import { randomUUID } from "node:crypto";
import { db } from "./db/index.ts";
import { log } from "./log.ts";
import { claim, checkpoint, fail, finish } from "./queue.ts";
import { executeRun, failRun } from "./runner.ts";

/**
 * Entrypoint 2 — the close-run consumer.
 *
 * A close over 50,000 rows reads a lot of Postgres and may call Gemini, which
 * does not fit inside an HTTP request. It runs here instead, one job at a time,
 * polling because Neon's HTTP driver has no LISTEN and a close arrives roughly
 * once a month per tenant — a second of latency is not the bottleneck.
 *
 * The interesting behaviour is shutdown. Render sends SIGTERM on every deploy,
 * so being killed mid-run is normal operation, not an incident. We stop taking
 * work and let the current tier finish; whatever was committed stays committed,
 * the lock expires, and the next worker resumes from the last checkpointed
 * stage. Nothing double-posts because every write is keyed and idempotent.
 */

const WORKER_ID = `${process.env.RENDER_INSTANCE_ID ?? "local"}-${randomUUID().slice(0, 8)}`;
const IDLE_MS = 1000;

let draining = false;

async function tick(): Promise<boolean> {
  if (!db || draining) return false;
  const database = db; // narrowed once, so the callbacks below keep it
  const job = await claim(database, WORKER_ID);
  if (!job) return false;

  log.info({ jobId: job.id, runId: job.runId, attempt: job.attempts, from: job.stage }, "job claimed");
  try {
    await executeRun(database, job.runId, job.datasetId, {
      onStage: (stage) => checkpoint(database, job.id, stage),
    });
    await finish(database, job.id);
  } catch (err) {
    log.error({ err, jobId: job.id }, "job failed");
    await fail(database, job, err);
    // Only tell the UI the run is dead once the queue has actually given up.
    // Saying so on a retryable failure would show a red run that then succeeds.
    if (job.attempts >= 3) await failRun(database, job.runId, err);
  }
  return true;
}

async function loop(): Promise<void> {
  while (!draining) {
    let worked = false;
    try {
      worked = await tick();
    } catch (err) {
      log.error({ err }, "queue poll failed"); // a Neon cold start, usually
    }
    if (!worked) await new Promise((r) => setTimeout(r, IDLE_MS));
  }
  log.info("worker drained");
  process.exit(0);
}

log.info({ workerId: WORKER_ID, db: Boolean(db) }, "worker up");
void loop();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log.info({ sig }, "worker draining — the current tier finishes, then we stop");
    draining = true;
    // Hard deadline: Render gives 30s. A tier that has not committed by then
    // is simply replayed by the next worker.
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}
