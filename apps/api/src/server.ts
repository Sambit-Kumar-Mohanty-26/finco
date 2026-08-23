import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { env } from "./env.ts";
import { log } from "./log.ts";
import { health } from "./routes/health.ts";

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
app.use(express.json({ limit: "2mb" }));

app.use(health);

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
