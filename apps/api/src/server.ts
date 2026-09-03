// FIRST, before anything it needs to patch. See instrument.ts.
import { Sentry } from "./instrument.ts";
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { env } from "./env.ts";
import { log } from "./log.ts";
import { health } from "./routes/health.ts";
import { datasetsRouter } from "./routes/datasets.ts";
import { runsRouter } from "./routes/runs.ts";
import { authRouter } from "./routes/auth.ts";
import { exceptionsRouter } from "./routes/exceptions.ts";
import { ledgerRouter } from "./routes/ledger.ts";
import { cashRouter } from "./routes/cash.ts";
import { settingsRouter } from "./routes/settings.ts";
import { periodsRouter } from "./routes/periods.ts";
import { webhooksRouter } from "./routes/webhooks.ts";

const app = express();
app.disable("x-powered-by");
// Render terminates TLS in front of the app, so without this req.ip is the
// proxy's address and the rate limiter below would count the whole internet as
// one caller. One hop, not `true` — trusting every hop lets a client spoof
// X-Forwarded-For and get a fresh bucket per request.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger: log,
    genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
  }),
);

/**
 * Vercel mints a new preview hostname per deploy, so a static allow-list fails
 * on every pull request. Match the project's preview pattern with a scoped
 * regex — never `origin: true`, which would let any site on the internet call
 * this API with credentials attached.
 */
const previewRe = /^https:\/\/finco-[a-z0-9-]+\.vercel\.app$/;
app.use(
  cors({
    origin(origin, cb) {
      // server-to-server (cron, worker, curl) sends no Origin header
      if (!origin) return cb(null, true);
      if (env.allowedOrigins.includes(origin) || previewRe.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

/**
 * A fixed-window rate limit, in memory.
 *
 * Enough to stop a login being brute-forced and a loop hammering ingest; not a
 * distributed limiter. Two API instances mean two windows, so the effective
 * ceiling doubles — acceptable, because the number it defends is a rough one.
 *
 * ponytail: per-process counter. Move to a Redis token bucket if there is ever
 * more than one instance and the ceiling has to be exact.
 */
const WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; until: number }>();

function limit(max: number): express.RequestHandler {
  return (req, res, next) => {
    const key = `${max}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const slot = hits.get(key);
    if (!slot || slot.until <= now) {
      hits.set(key, { n: 1, until: now + WINDOW_MS });
      // Sweep here rather than on a timer: the map only grows while requests
      // arrive, so the thing that fills it is the thing that empties it.
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
      return next();
    }
    slot.n += 1;
    if (slot.n > max) {
      res.set("Retry-After", String(Math.ceil((slot.until - now) / 1000)));
      return res.status(429).json({ error: "too many requests" });
    }
    next();
  };
}

/**
 * Razorpay webhooks need the RAW bytes to verify their HMAC signature, so the
 * webhook router must be mounted BEFORE the JSON body parser. Getting this
 * order wrong is silent: signatures simply never verify.
 */
app.use("/webhooks", limit(600), express.raw({ type: "application/json", limit: "1mb" }));
app.use(webhooksRouter);

/**
 * Request size caps, in two sizes.
 *
 * Ingest genuinely carries megabytes — 50,000 recon rows of JSON — so it gets
 * 64mb. Everything else is a handful of fields, and a 64mb ceiling on a login
 * body is free memory for anyone who wants it. The first parser to run wins;
 * body-parser marks the request and the second one skips it.
 */
app.use("/v1/datasets", limit(30), express.json({ limit: "64mb" }));
app.use("/v1/auth", limit(20));
app.use(limit(300), express.json({ limit: "1mb" }));

/**
 * JSON has no bigint, and JSON.stringify THROWS on one rather than coercing —
 * so without this every money field would 500 instead of rendering. Paise go
 * over the wire as decimal strings and are converted back exactly once, by
 * @finco/core on the other side.
 */
app.set("json replacer", (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

app.use(health);
app.use(authRouter);
app.use(datasetsRouter);
app.use(runsRouter);
app.use(exceptionsRouter);
app.use(ledgerRouter);
app.use(cashRouter);
app.use(settingsRouter);
app.use(periodsRouter);

app.use((_req, res) => res.status(404).json({ error: "not found" }));

// Before the handler below, which is what turns an error into a 500 — Sentry
// must see it while it is still an exception.
Sentry.setupExpressErrorHandler(app);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    log.error({ err }, "unhandled");
    res.status(500).json({ error: "internal error" });
  },
);

const server = app.listen(env.port, () => {
  log.info(
    { port: env.port, sha: env.gitSha, db: Boolean(env.databaseUrl) },
    "api listening",
  );
});

// Render sends SIGTERM on deploy; drain rather than drop in-flight requests
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log.info({ sig }, "shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
