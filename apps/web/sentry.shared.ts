import type { init } from "@sentry/nextjs";

/**
 * One Sentry config for all three runtimes (node, edge, browser).
 *
 * Next wants three separate entrypoints, but the options are the same in all
 * three and three copies of them drift. The DSN is NEXT_PUBLIC_* because the
 * browser build needs it inlined; absent means the SDK never initialises and
 * nothing leaves the machine, which is how local dev and CI stay offline.
 */
export const SENTRY_OPTIONS: Parameters<typeof init>[0] = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  // Errors only, same as the API. Web Vitals are Vercel's job and already free.
  tracesSampleRate: 0,
  // Settlement refs and amounts render on these pages. None of that belongs in
  // a third-party error tracker.
  sendDefaultPii: false,
};
