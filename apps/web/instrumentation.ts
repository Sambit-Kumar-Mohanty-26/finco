import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { SENTRY_OPTIONS } from "./sentry.shared";

export function register(): void {
  Sentry.init(SENTRY_OPTIONS);
}

/**
 * Server-side render and route-handler errors.
 *
 * The run id is in the path — /runs/<uuid> — so tagging it from the URL costs
 * one regex and means a Sentry issue can be opened straight against the close
 * it broke on, which is the only question anyone asks first.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const runId = /\/runs\/([0-9a-f-]{36})/i.exec(request.path ?? "")?.[1];
  Sentry.withScope((scope) => {
    if (runId) scope.setTag("runId", runId);
    Sentry.captureRequestError(err, request, context);
  });
};
