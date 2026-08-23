import { log } from "./log.ts";

/**
 * Entrypoint 3 — the nightly Razorpay recon pull (06:00 IST = 00:30 UTC).
 *
 * Webhooks are a latency optimisation; this pull is the source of truth,
 * because a missed webhook is a silent variance. P8 fills it in.
 */
log.info("cron: recon pull — not implemented until P8");
process.exit(0);
