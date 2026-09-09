import { Sentry } from "./instrument.ts";
import { eq } from "drizzle-orm";
import { db } from "./db/index.ts";
import { datasets, runs } from "./db/schema.ts";
import { env } from "./env.ts";
import { log } from "./log.ts";
import { enqueue } from "./queue.ts";
import { ingestBundle, inputHash } from "./routes/datasets.ts";
import { audit, scoped } from "./policy.ts";

/**
 * Entrypoint 3 — the nightly Razorpay pull (06:00 IST = 00:30 UTC).
 *
 * The webhook is a latency optimisation; THIS is the source of truth. A webhook
 * that never arrives is a variance nobody sees, and "nobody told us" is not a
 * reconciliation strategy. So the pull runs every night regardless of what
 * webhooks did or did not deliver, and the two are allowed to disagree — the
 * pull wins.
 *
 * It ingests and enqueues. It does not reconcile inline: the worker already
 * knows how to resume a half-finished close, and duplicating that here would be
 * a second implementation of the only part that is hard.
 */

const BASE = "https://api.razorpay.com/v1";
const PAGE = 100;

/** Yesterday in IST — the last day the gateway has finished settling. */
function yesterdayIst(): { y: number; m: number; d: number; iso: string } {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000 - 86_400_000);
  const iso = t.toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d!, iso };
}

async function get(path: string): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64");
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Basic ${auth}` },
    // A cron that hangs holds a Render job open until the platform kills it,
    // and the log then says nothing about why.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`razorpay ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Walk a paginated collection to the end. */
async function all(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await get(`${path}${sep}count=${PAGE}&skip=${skip}`);
    const items = (page.items ?? []) as Record<string, unknown>[];
    out.push(...items);
    if (items.length < PAGE) return out;
    // 50,000 is the ingest cap, and a runaway pagination loop against a paid
    // API is a bill rather than an error.
    if (out.length >= 50_000) {
      log.warn({ path, rows: out.length }, "pull stopped at the ingest cap");
      return out;
    }
  }
}

const P = (v: unknown) => BigInt(Math.round(Number(v ?? 0)));

/**
 * Map Razorpay's combined recon feed onto the recon_rows shape.
 *
 * Amounts arrive in paise already, which is the whole reason this codebase
 * carries paise end to end: there is no conversion here to get wrong.
 * `credit` is NET OF FEE on the gateway side too — do not subtract it again.
 */
function toBundle(recon: Record<string, unknown>[], setls: Record<string, unknown>[]) {
  return {
    settlements: setls.map((s) => ({
      ref: String(s.id),
      utr: s.utr == null ? null : String(s.utr),
      amountPaise: P(s.amount).toString(),
      feePaise: P(s.fees).toString(),
      taxPaise: P(s.tax).toString(),
      settledOn: new Date(Number(s.created_at ?? 0) * 1000).toISOString().slice(0, 10),
      onHold: false,
    })),
    reconRows: recon.map((r, i) => ({
      settlementRef: r.settlement_id == null ? null : String(r.settlement_id),
      type: String(r.type ?? "payment"),
      entityId: String(r.entity_id ?? `row_${i}`),
      orderId: r.order_id == null ? null : String(r.order_id),
      paymentId: r.payment_id == null ? null : String(r.payment_id),
      creditPaise: P(r.credit).toString(),
      debitPaise: P(r.debit).toString(),
      feePaise: P(r.fee).toString(),
      taxPaise: P(r.tax).toString(),
      disputeId: r.dispute_id == null ? null : String(r.dispute_id),
      description: r.description == null ? null : String(r.description),
      currency: String(r.currency ?? "INR"),
      capturedOn:
        r.captured_at || r.created_at
          ? new Date(Number(r.captured_at ?? r.created_at) * 1000).toISOString().slice(0, 10)
          : null,
    })),
    // No bank feed from Razorpay. I1 still closes on this data; I2 waits for the
    // statement, which arrives by a different route and parks until it does.
    bankLines: [],
    erpInvoices: [],
  };
}

async function main(): Promise<void> {
  if (!db) {
    log.warn("cron: no database configured");
    return;
  }
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    // Exit 0, not 1. An unconfigured cron is a deployment state, not a failure,
    // and a nightly red cross that everyone learns to ignore is worse than no
    // alert at all.
    log.info("cron: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — nothing to pull");
    return;
  }
  // Keys are set, so this pull is about to write real settlements into somebody's
  // books. WHICH books cannot be worked out from the data: one API key is one
  // merchant account, and the response never names a tenant. Defaulting to
  // "demo" would be the worst available answer — the month would ingest, close
  // cleanly, and belong to nobody, which no reconciliation can detect.
  //
  // ponytail: one tenant per deployment, because the credentials in the
  // environment are one merchant's. Loop over tenant_connections instead once
  // key material lives in the database.
  if (!env.cronTenantId) {
    throw new Error("RAZORPAY keys are set but CRON_TENANT_ID is not — refusing to guess whose books these are");
  }
  const tenantId = env.cronTenantId;

  const { y, m, d, iso } = yesterdayIst();
  const period = iso.slice(0, 7);

  const recon = await all(`/settlements/recon/combined?year=${y}&month=${m}&day=${d}`);
  const setls = await all(`/settlements?year=${y}&month=${m}&day=${d}`);
  log.info({ day: iso, recon: recon.length, settlements: setls.length }, "cron: pulled");

  if (recon.length === 0) {
    log.info({ day: iso }, "cron: nothing settled — no dataset created");
    return;
  }

  const name = `Razorpay ${iso}`;
  // Idempotent on the name, which encodes the day. A cron that is retried, or
  // that runs twice because a deploy overlapped it, must not ingest the same
  // day twice — and the run below is idempotent on contents anyway.
  const [existing] = await db
    .select()
    .from(datasets)
    .where(scoped(datasets, tenantId, eq(datasets.name, name), eq(datasets.source, "razorpay")));
  const ds =
    existing ??
    (await ingestBundle(toBundle(recon, setls), { name, period, source: "razorpay", tenantId }));

  const hash = inputHash(ds.id, (ds as { counts: Record<string, number> }).counts ?? {});
  const [run] =
    (await db
      .select()
      .from(runs)
      .where(scoped(runs, tenantId, eq(runs.datasetId, ds.id), eq(runs.inputHash, hash)))) ?? [];
  const target =
    run ??
    (
      await db
        .insert(runs)
        .values({ tenantId, datasetId: ds.id, period, inputHash: hash, state: "QUEUED" })
        .returning()
    )[0];
  if (!target) throw new Error("run insert returned nothing");

  await enqueue(db, target.id, ds.id);
  await audit({ tenantId }, "cron.pull", { type: "dataset", ref: ds.id }, { day: iso, rows: recon.length, runId: target.id });
  log.info({ day: iso, datasetId: ds.id, runId: target.id }, "cron: run queued");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    Sentry.captureException(err);
    log.error({ err }, "cron: pull failed");
    process.exit(1);
  });
