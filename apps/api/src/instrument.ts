import * as Sentry from "@sentry/node";
import { env } from "./env.ts";

/**
 * Sentry, imported FIRST by every entrypoint.
 *
 * It has to be first: the SDK patches http, pg and the rest at import time, and
 * anything already imported keeps the unpatched version. A stack trace that is
 * missing the query which caused it is the failure mode, and it is silent.
 *
 * No DSN means no init and no network calls, which is how local dev and CI stay
 * offline. Errors are still logged by pino either way — Sentry groups them and
 * keeps the stack, it is not where they are recorded.
 */
if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    // Ties an error to the exact deploy. Render, Vercel and Actions each name
    // the commit differently; env.gitSha already reconciles the three.
    release: env.gitSha,
    // Errors only. Performance tracing on a service whose slowest path is a
    // deliberate 5,000-row scan would bill for confirming what the scorecard
    // already measures.
    tracesSampleRate: 0,
    // A close run carries settlement references and amounts. None of that
    // belongs in a third-party error tracker.
    sendDefaultPii: false,
  });
}

export { Sentry };
