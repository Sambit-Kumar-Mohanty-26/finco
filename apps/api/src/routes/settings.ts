import { Router } from "express";
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  bankLines,
  datasets,
  erpInvoices,
  policies,
  reconRows,
  settlements,
  webhookEvents,
} from "../db/schema.ts";
import { attachActor, requireRole } from "../auth.ts";
import {
  AUTONOMY_MODES,
  audit,
  POLICY_DEFAULTS,
  readChain,
  readPolicy,
  scoped,
  tenantOf,
  verifyChain,
} from "../policy.ts";
import { env } from "../env.ts";

export const settingsRouter = Router();
settingsRouter.use(attachActor);

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * GET /v1/settings/connections — prove each source with a real row.
 *
 * "Connected" as a green tick is a lie waiting to happen: credentials can be
 * valid while the feed returns nothing, and a page that says CONNECTED over an
 * empty table is worse than one that says nothing. So each source reports its
 * newest actual row and the count behind it. If there is no row, the status is
 * NO DATA, however healthy the credentials are.
 */
settingsRouter.get("/v1/settings/connections", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const database = db;

    const ids = await database
      .select({ id: datasets.id })
      .from(datasets)
      .where(scoped(datasets, tenantId));
    const datasetIds = ids.map((d) => d.id);

    const countOf = async (table: typeof settlements | typeof reconRows | typeof bankLines | typeof erpInvoices) => {
      if (datasetIds.length === 0) return 0;
      const [row] = await database
        .select({ n: count() })
        .from(table)
        .where(sql`${table.datasetId} in ${datasetIds}`);
      return Number(row?.n ?? 0);
    };

    const [newestSettlement] = datasetIds.length
      ? await database
          .select({ ref: settlements.ref, on: settlements.settledOn })
          .from(settlements)
          .where(sql`${settlements.datasetId} in ${datasetIds}`)
          .orderBy(desc(settlements.settledOn))
          .limit(1)
      : [];
    const [newestBank] = datasetIds.length
      ? await database
          .select({ ref: bankLines.ref, on: bankLines.valueDate })
          .from(bankLines)
          .where(sql`${bankLines.datasetId} in ${datasetIds}`)
          .orderBy(desc(bankLines.valueDate))
          .limit(1)
      : [];

    const [hook] = await database
      .select({ at: webhookEvents.receivedAt, type: webhookEvents.eventType })
      .from(webhookEvents)
      .where(scoped(webhookEvents, tenantId, eq(webhookEvents.signatureOk, true)))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(1);
    const [badSig] = await database
      .select({ n: count() })
      .from(webhookEvents)
      .where(scoped(webhookEvents, tenantId, eq(webhookEvents.signatureOk, false)));

    /**
     * order_receipt coverage. An ERP invoice can only be matched through the
     * receipt the gateway carries, so a gap here caps the achievable match rate
     * no matter how good the tiers are — and the fix is a gateway configuration
     * change, not an engine change. Saying which is the difference between a
     * useful number and a discouraging one.
     */
    const totalErp = await countOf(erpInvoices);
    const [covered] = datasetIds.length
      ? await database
          .select({ n: count() })
          .from(reconRows)
          .where(and(sql`${reconRows.datasetId} in ${datasetIds}`, isNotNull(reconRows.orderId)))
      : [];
    const rows = await countOf(reconRows);
    const coveragePct = rows === 0 ? null : Math.round((Number(covered?.n ?? 0) / rows) * 1000) / 10;

    res.json({
      sources: [
        {
          key: "razorpay_settlements",
          label: "Razorpay settlements",
          status: (await countOf(settlements)) > 0 ? "OK" : "NO DATA",
          rows: await countOf(settlements),
          newest: newestSettlement ? `${newestSettlement.ref} settled ${newestSettlement.on}` : null,
        },
        {
          key: "razorpay_recon",
          label: "Razorpay combined recon",
          status: rows > 0 ? "OK" : "NO DATA",
          rows,
          newest: null,
        },
        {
          key: "bank_statement",
          label: "Bank statement",
          status: (await countOf(bankLines)) > 0 ? "OK" : "NO DATA",
          rows: await countOf(bankLines),
          newest: newestBank ? `${newestBank.ref} value ${newestBank.on}` : null,
        },
        {
          key: "erp_invoices",
          label: "ERP invoices",
          status: totalErp > 0 ? "OK" : "NO DATA",
          rows: totalErp,
          newest: null,
        },
        {
          key: "webhook",
          label: "Razorpay webhook",
          status: !env.razorpayWebhookSecret ? "NOT CONFIGURED" : hook ? "OK" : "NO DATA",
          rows: 0,
          newest: hook ? `${hook.type} at ${hook.at.toISOString()}` : null,
          signatureFailures: Number(badSig?.n ?? 0),
        },
      ],
      orderReceiptCoverage: {
        pct: coveragePct,
        rowsWithReceipt: Number(covered?.n ?? 0),
        rowsTotal: rows,
        fix: "Send order_id on every capture from the gateway checkout. Rows without one can only ever be matched on amount and date, which is the tier that refuses when two amounts tie.",
      },
    });
  } catch (e) {
    next(e);
  }
});

/** GET /v1/settings/policy — the effective policy, defaults included. */
settingsRouter.get("/v1/settings/policy", async (req, res, next) => {
  try {
    const policy = await readPolicy(tenantOf(req.actor));
    res.json({ ...policy, modes: AUTONOMY_MODES, defaults: POLICY_DEFAULTS });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/settings/policy — change it.
 *
 * Approver only, and audited. These four numbers decide what posts without a
 * person looking at it, so "who widened the autonomy cap and when" has to be
 * answerable from the record rather than from memory.
 */
settingsRouter.post("/v1/settings/policy", requireRole("approver"), async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const tenantId = tenantOf(req.actor);
    const before = await readPolicy(tenantId);
    const body = req.body ?? {};

    const paise = (v: unknown, fallback: bigint): bigint => {
      if (v === undefined || v === null || v === "") return fallback;
      const s = String(v).trim();
      if (!/^\d+$/.test(s)) throw Object.assign(new Error("money must be an integer string of paise"), { status: 400 });
      return BigInt(s);
    };

    const mode = String(body.autonomyMode ?? before.autonomyMode);
    if (!AUTONOMY_MODES.includes(mode as (typeof AUTONOMY_MODES)[number])) {
      return res.status(400).json({ error: `autonomyMode must be one of ${AUTONOMY_MODES.join(", ")}` });
    }

    const killSwitch = body.killSwitch === undefined ? before.killSwitch : Boolean(body.killSwitch);
    const killReason = String(body.killReason ?? before.killReason).slice(0, 300);
    // Turning the switch ON without a reason is how a banner ends up on every
    // screen for a week with nobody remembering why.
    if (killSwitch && !before.killSwitch && killReason.trim() === "") {
      return res.status(400).json({ error: "say why the kill switch is going on — it appears on every screen" });
    }

    const values = {
      tenantId,
      autonomyCapPaise: paise(body.autonomyCapPaise, before.autonomyCapPaise),
      materialityPaise: paise(body.materialityPaise, before.materialityPaise),
      cashFloorPaise: paise(body.cashFloorPaise, before.cashFloorPaise),
      suspenseCeilingPaise: paise(body.suspenseCeilingPaise, before.suspenseCeilingPaise),
      autonomyMode: mode,
      killSwitch,
      killReason,
      updatedBy: req.actor?.email ?? "",
      updatedAt: new Date(),
    };

    await db
      .insert(policies)
      .values(values)
      .onConflictDoUpdate({ target: policies.tenantId, set: values });

    await audit(req.actor, "policy.update", { type: "policy", ref: tenantId }, {
      from: {
        autonomyCapPaise: before.autonomyCapPaise.toString(),
        materialityPaise: before.materialityPaise.toString(),
        cashFloorPaise: before.cashFloorPaise.toString(),
        suspenseCeilingPaise: before.suspenseCeilingPaise.toString(),
        autonomyMode: before.autonomyMode,
        killSwitch: before.killSwitch,
      },
      to: {
        autonomyCapPaise: values.autonomyCapPaise.toString(),
        materialityPaise: values.materialityPaise.toString(),
        cashFloorPaise: values.cashFloorPaise.toString(),
        suspenseCeilingPaise: values.suspenseCeilingPaise.toString(),
        autonomyMode: values.autonomyMode,
        killSwitch: values.killSwitch,
      },
    });

    res.json(await readPolicy(tenantId));
  } catch (e) {
    if ((e as { status?: number }).status === 400) {
      return res.status(400).json({ error: (e as Error).message });
    }
    next(e);
  }
});

/**
 * GET /v1/settings/audit — the chain, and whether it verifies.
 *
 * The verdict is computed on read rather than stored, because a stored "this is
 * fine" flag is exactly the thing an edit would also update.
 */
settingsRouter.get("/v1/settings/audit", async (req, res, next) => {
  try {
    const entries = await readChain(tenantOf(req.actor));
    res.json({
      entries: entries.map((e) => ({
        seq: e.seq,
        at: e.at.toISOString(),
        actorEmail: e.actorEmail,
        action: e.action,
        subjectType: e.subjectType,
        subjectRef: e.subjectRef,
        detail: e.detail,
        hash: e.hash.slice(0, 12),
      })),
      chain: verifyChain(entries),
    });
  } catch (e) {
    next(e);
  }
});
