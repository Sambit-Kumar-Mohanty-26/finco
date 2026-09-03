import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "./sentry.shared";

Sentry.init(SENTRY_OPTIONS);

// Next needs this to report navigation errors; it is a no-op without a DSN.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
