import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import {
  attachActor,
  COOKIE,
  cookieOptions,
  createSession,
  hashPassword,
  readCookie,
  revokeSession,
  verifyPassword,
} from "../auth.ts";

export const authRouter = Router();
authRouter.use(attachActor);

const needDb = (res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(503).json({ error: "database not configured" });

/**
 * Sign in.
 *
 * The failure message is the same whether the email is unknown or the password
 * is wrong, and the password is hashed even when no user was found. Both are
 * about not turning the login form into an account-existence oracle — the
 * second one because skipping the hash makes an unknown email answer measurably
 * faster than a known one.
 */
const DUMMY = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

authRouter.post("/v1/auth/login", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY);
    if (!user || !ok) return res.status(401).json({ error: "email or password is wrong" });

    const { token, expiresAt } = await createSession(user.id);
    res.cookie(COOKIE, token, cookieOptions(expiresAt));
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/v1/auth/logout", async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, COOKIE);
    if (token) await revokeSession(token);
    res.clearCookie(COOKIE, { path: "/" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/** Who am I. The frontend gates its own UI on this; the API gates itself. */
authRouter.get("/v1/auth/me", (req, res) => {
  if (!req.actor) return res.status(401).json({ error: "not signed in" });
  res.json(req.actor);
});

/**
 * Seed the first user. Refuses once anybody exists, so it cannot be used to
 * add an approver to a live tenant — that is an invite flow, not this.
 */
authRouter.post("/v1/auth/bootstrap", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const [existing] = await db.select({ id: users.id }).from(users).limit(1);
    if (existing) return res.status(409).json({ error: "already bootstrapped" });
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!email.includes("@") || password.length < 12) {
      return res.status(400).json({ error: "a real email and a password of at least 12 characters" });
    }
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash: await hashPassword(password),
        name: String(req.body?.name ?? "").slice(0, 80),
        role: "approver",
      })
      .returning();
    res.status(201).json({ id: user!.id, email: user!.email, role: user!.role });
  } catch (e) {
    next(e);
  }
});
