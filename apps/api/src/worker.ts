import { log } from "./log.ts";

/**
 * Entrypoint 2 — the close-run consumer.
 *
 * A close run over 5,000 rows takes 60–180 seconds and calls Anthropic several
 * times, which does not fit an HTTP request or a serverless budget. It lives
 * here so P3 can add pg-boss without moving anything.
 *
 * pg-boss must use env.databaseUrlDirect, not env.databaseUrl: its LISTEN-based
 * work behaves unpredictably through Neon's pooler.
 */
log.info("worker up — no queue yet (P3 adds pg-boss)");

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log.info({ sig }, "worker shutting down");
    process.exit(0);
  });
}

setInterval(() => {}, 1 << 30);
