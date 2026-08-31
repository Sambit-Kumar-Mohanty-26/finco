import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.ts";
import { sessions, users, type User } from "./db/schema.ts";

/**
 * Sessions, by hand.
 *
 * Three decisions worth stating, because each is a place where the convenient
 * version is the insecure one:
 *
 *  - Passwords go through scrypt, which is in node:crypto. Node's own KDF with
 *    a per-user salt is not a weaker bcrypt, it is a memory-hard one, and it
 *    costs no dependency.
 *  - The session token is random and only its SHA-256 is stored. A dump of the
 *    sessions table then does not let anyone log in as anybody, which is not
 *    true of a table of usable tokens. Lookup is by hash, so it stays one
 *    indexed read.
 *  - The tenant comes from the session row. Never from the body, never from a
 *    header. Trusting a client-supplied tenant id is how one merchant reads
 *    another's ledger, and it looks exactly like normal code until it does.
 *
 * No JWT: a stateless token cannot be revoked, and "log this person out now" is
 * a requirement the moment a real finance team uses this.
 */

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const SESSION_DAYS = 7;
export const COOKIE = "finco_session";

export type Role = "viewer" | "preparer" | "approver";
/** Who may do what. Approving a posting is not the same right as preparing one. */
const RANK: Record<Role, number> = { viewer: 0, preparer: 1, approver: 2 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

const HEX = /^[0-9a-f]+$/;

/**
 * Constant-time, and false rather than throwing on a malformed stored hash.
 *
 * The length checks are not defensive padding. Buffer.from("zz", "hex") is an
 * EMPTY buffer, not an error, so without them a row whose hash was corrupted or
 * hand-edited derives a zero-length key, compares equal to another zero-length
 * key, and authenticates anybody. A stored hash that is not exactly what we
 * wrote is a refusal.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  if (!HEX.test(saltHex) || !HEX.test(keyHex)) return false;
  if (keyHex.length !== KEYLEN * 2 || saltHex.length % 2 !== 0) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = (await scryptAsync(password, Buffer.from(saltHex, "hex"), KEYLEN)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  if (!db) throw new Error("no database");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: tokenHash(token), expiresAt });
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  if (!db) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash(token)));
}

/**
 * Read one cookie. Six lines beats a dependency, and cookie-parser would still
 * need this much configuration.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function cookieOptions(expiresAt: Date) {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true, // JavaScript must not be able to read it — that is the XSS blast radius
    secure: prod,
    /**
     * None in production, and this is not a relaxation.
     *
     * The web app is on vercel.app and the API is on onrender.com, so every
     * resolve, approve and undo is a CROSS-SITE fetch. Lax sends a cookie on a
     * top-level navigation only, never on fetch — so Lax here would 401 every
     * mutation in production while looking perfectly correct in development,
     * where both sides are localhost and therefore same-site. None requires
     * Secure, which is why it is used only when the connection is one. CSRF is
     * held off by the scoped CORS allow-list in server.ts, not by SameSite.
     */
    sameSite: prod ? ("none" as const) : ("lax" as const),
    path: "/",
    expires: expiresAt,
  };
}

export type Actor = Pick<User, "id" | "tenantId" | "email" | "name" | "role">;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

/** Attach the actor if there is a valid session. Never rejects; guards do that. */
export async function attachActor(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token =
    readCookie(req.headers.cookie, COOKIE) ??
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
  if (!token || !db) return next();
  try {
    const [row] = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash(token)),
          gt(sessions.expiresAt, new Date()),
          isNull(sessions.revokedAt),
        ),
      );
    if (row) req.actor = row;
  } catch {
    // A database blip must not turn into a 500 on a public page.
  }
  next();
}

/**
 * Require a role. Every mutation gets one of these — not the router, the route,
 * because a guard applied to a router is a guard somebody forgets to re-apply
 * when a route moves.
 */
export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const actor = req.actor;
    if (!actor) return res.status(401).json({ error: "sign in first" });
    if (RANK[actor.role as Role] === undefined || RANK[actor.role as Role] < RANK[min]) {
      return res.status(403).json({ error: `this needs the ${min} role; you have ${actor.role}` });
    }
    next();
  };
}
