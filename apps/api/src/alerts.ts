import { env } from "./env.ts";
import { log } from "./log.ts";

/**
 * The four things worth waking someone for.
 *
 * Not a monitoring product — a stable log line plus one optional webhook. Every
 * alert carries a `code` from the list below, which is what a log drain filters
 * on; adding a fifth free-text warning somewhere else in the codebase would not
 * be an alert, it would be a log line nobody has a rule for.
 *
 * Alerting NEVER throws. An alert that can fail the operation it was reporting
 * on turns a warning into an outage, which is the one failure mode a warning
 * system must not have.
 */

export const ALERTS = {
  run_failed: "A close run failed",
  identity_closure: "Identity closure is below 100%",
  webhook_signature: "Webhook signatures are failing",
  suspense_ceiling: "Suspense is above its ceiling",
} as const;

export type AlertCode = keyof typeof ALERTS;

/**
 * Fire one alert.
 *
 * ponytail: a single webhook POST, no retry and no dedupe. If a flapping
 * condition ever floods the channel, add a per-code cooldown here — not at the
 * call sites, which should stay ignorant of how loud they are.
 */
export async function alert(
  code: AlertCode,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  // Structured first, always. The webhook is the optional part; the log line is
  // the record, and it exists whether or not anyone configured a destination.
  log.error({ alert: code, ...detail }, `${ALERTS[code]}: ${message}`);

  if (!env.alertWebhookUrl) return;
  try {
    await fetch(env.alertWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Slack, Discord and Teams all accept a bare { text }, so this works
      // against all three without a per-provider formatter.
      body: JSON.stringify({
        text: `[${env.nodeEnv}] ${ALERTS[code]} — ${message}`,
        code,
        detail,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    log.warn({ err, alert: code }, "alert webhook failed — the log line above is the record");
  }
}
