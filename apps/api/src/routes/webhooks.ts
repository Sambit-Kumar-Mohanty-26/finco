import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.ts";
import { webhookEvents } from "../db/schema.ts";
import { env } from "../env.ts";
import { alert } from "../alerts.ts";

export const webhooksRouter = Router();

/**
 * POST /webhooks/razorpay
 *
 * Mounted BEFORE express.json() with a raw body parser, because the signature
 * is an HMAC over the exact bytes Razorpay sent. Parsing and re-serialising the
 * JSON changes key order and whitespace, and the signature then never verifies
 * — silently, on every event, in production only. That is why the mount order
 * in server.ts carries a comment rather than being left to look arbitrary.
 *
 * The webhook is a LATENCY OPTIMISATION and nothing more. The nightly cron pull
 * in cron.ts is the source of truth, because a webhook that never arrives is a
 * variance nobody sees. Everything here is written down and reconciled later;
 * nothing posts to a ledger on the strength of an HTTP request from outside.
 */

/** Compare in constant time, and never throw on a malformed header. */
export function signatureMatches(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "hex");
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through an exception. Check first, compare second.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

webhooksRouter.post("/webhooks/razorpay", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const secret = env.razorpayWebhookSecret;

  // No secret configured means the endpoint is not live. Answer 503 rather than
  // accepting unverifiable events into a table that is later trusted.
  if (!secret) return res.status(503).json({ error: "webhook secret not configured" });

  const ok = signatureMatches(raw, req.header("x-razorpay-signature") ?? undefined, secret);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    // A body that will not parse cannot be an event we understand. Say so, and
    // do not retry-loop Razorpay by answering 5xx.
    return res.status(400).json({ error: "unparseable body" });
  }

  const eventId = req.header("x-razorpay-event-id") ?? String(payload.id ?? "");
  const eventType = String(payload.event ?? "");

  if (!ok) {
    // Recorded, not discarded: a run of signature failures is an alert, and one
    // you cannot see is one nobody responds to. Still a 401 — a bad signature
    // must never be answered 2xx, or a forger learns nothing happened either way.
    // A run of these means the secret here and the one in the Razorpay
    // dashboard have drifted, and every event since then was refused.
    await alert("webhook_signature", `event ${eventId || "(no id)"} failed HMAC verification`, {
      eventId,
      eventType,
    });
    if (db && eventId) {
      await db
        .insert(webhookEvents)
        .values({ eventId, eventType, signatureOk: false, payload: {} })
        .onConflictDoNothing();
    }
    return res.status(401).json({ error: "signature mismatch" });
  }

  if (!eventId) return res.status(400).json({ error: "no event id to be idempotent on" });
  if (!db) return res.status(503).json({ error: "database not configured" });

  // Idempotent on the provider's event id. Razorpay retries anything it did not
  // get a 2xx for within a few seconds, so redelivery is the normal case and a
  // duplicate must be a no-op rather than a second row.
  await db
    .insert(webhookEvents)
    .values({ eventId, eventType, signatureOk: true, payload })
    .onConflictDoNothing();

  // 200 immediately. Whatever this event means is worked out by the nightly
  // pull against the settlements API; doing it inline would put a third party's
  // retry timer in charge of how long our reconciliation may take.
  res.json({ received: true, eventId });
});
