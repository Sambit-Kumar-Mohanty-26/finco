import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { env } from "./env.ts";
import { log } from "./log.ts";
import { health } from "./routes/health.ts";
import { datasetsRouter } from "./routes/datasets.ts";
import { runsRouter } from "./routes/runs.ts";

const app = express();
app.disable("x-powered-by");

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
 * Razorpay webhooks need the RAW bytes to verify their HMAC signature, so the
 * webhook router must be mounted BEFORE the JSON body parser. Getting this
 * order wrong is silent: signatures simply never verify.
 */
// app.use("/webhooks", express.raw({ type: "application/json" }), webhooks);
// 5,000 recon rows of JSON is a few MB, and the ingest cap is 50,000.
app.use(express.json({ limit: "64mb" }));

/**
 * JSON has no bigint, and JSON.stringify THROWS on one rather than coercing —
 * so without this every money field would 500 instead of rendering. Paise go
 * over the wire as decimal strings and are converted back exactly once, by
 * @finco/core on the other side.
 */
app.set("json replacer", (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

app.use(health);
app.use(datasetsRouter);
app.use(runsRouter);

app.use((_req, res) => res.status(404).json({ error: "not found" }));

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
