import { Router, type Response } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { env } from "../env.ts";
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

/**
 * What sign-in methods exist.
 *
 * Public, and the only thing it reveals is whether a button should be drawn.
 * The alternative is a second NEXT_PUBLIC_* flag on the web app, which means
 * configuring Google in two places and getting a button that 503s when someone
 * sets only one of them.
 */
authRouter.get("/v1/auth/config", (_req, res) => {
  res.json({ google: Boolean(env.googleClientId && env.googleClientSecret) });
});

/** Who am I. The frontend gates its own UI on this; the API gates itself. */
authRouter.get("/v1/auth/me", (req, res) => {
  if (!req.actor) return res.status(401).json({ error: "not signed in" });
  res.json(req.actor);
});

/**
 * Sign up.
 *
 * A NEW TENANT, every time. The `tenant_id` column defaults to "demo", so a
 * signup that accepted the default would drop a stranger straight into someone
 * else's books. The signer-up is the only person in their own tenant, so they
 * are an approver: a workspace whose sole occupant cannot set its own policy is
 * not a workspace.
 *
 * Adding a SECOND person to an existing tenant is an invite flow, and there
 * isn't one yet. Until there is, a colleague who signs up gets their own empty
 * workspace rather than a seat in yours — the safe direction to be wrong in.
 */
async function createAccount(
  email: string,
  name: string,
  passwordHash: string | null,
): Promise<typeof users.$inferSelect> {
  const [user] = await db!
    .insert(users)
    .values({ tenantId: randomUUID(), email, passwordHash, name: name.slice(0, 80), role: "approver" })
    .returning();
  return user!;
}

const shape = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  tenantId: u.tenantId,
});

authRouter.post("/v1/auth/signup", async (req, res, next) => {
  if (!db) return needDb(res);
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!email.includes("@") || email.length > 254) {
      return res.status(400).json({ error: "that does not look like an email address" });
    }
    // Twelve, not eight. The only defence a stolen database has is the cost of
    // the hash times the size of the search space, and length is the only one
    // of those two that a signup form controls.
    if (password.length < 12) {
      return res.status(400).json({ error: "a password of at least 12 characters" });
    }

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) {
      // Deliberately not "that email is taken": a signup form that confirms an
      // address is registered is an account-existence oracle, and the addresses
      // it would confirm belong to a finance system.
      return res
        .status(409)
        .json({ error: "if that address can be used, it is already in use — try signing in" });
    }

    const user = await createAccount(email, String(req.body?.name ?? ""), await hashPassword(password));
    const { token, expiresAt } = await createSession(user.id);
    res.cookie(COOKIE, token, cookieOptions(expiresAt));
    res.status(201).json(shape(user));
  } catch (e) {
    next(e);
  }
});

/* --- Google ---------------------------------------------------------------
 *
 * The authorization-code flow, by hand, with no OAuth library. Two fetches and
 * a base64url decode is smaller than the smallest dependency that would do it,
 * and the parts that matter are the parts a library would hide.
 *
 * ONE endpoint for both sign-in and sign-up. Google does not tell us which the
 * user intended, and the answer is the same either way: an account with this
 * verified address exists, or it does not.
 */

const STATE_COOKIE = "finco_oauth_state";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/** Where the browser lands when this is over. Must be an allowed origin. */
const webUrl = () => env.allowedOrigins[0] ?? "http://localhost:3000";
const redirectUri = () => `${env.publicApiUrl}/v1/auth/google/callback`;

const bounce = (res: Response, error: string) =>
  res.redirect(`${webUrl()}/login?error=${encodeURIComponent(error)}`);

authRouter.get("/v1/auth/google", (_req, res) => {
  if (!env.googleClientId || !env.googleClientSecret) {
    return res.status(503).json({ error: "google sign-in is not configured" });
  }
  // CSRF for the round trip: a value we minted, kept in a cookie the attacker's
  // site cannot read, compared on the way back. Without it anyone can feed a
  // victim's browser their own authorization code and sign them into the
  // attacker's account.
  const state = randomBytes(32).toString("base64url");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    // Same reasoning as the session cookie: Google's redirect back to us is
    // cross-site, and Lax would drop the cookie on the one request that needs it.
    sameSite: env.nodeEnv === "production" ? "none" : "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", env.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // We want an identity, not a mailbox: no refresh token, nothing stored.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

/**
 * Read the claims out of an ID token.
 *
 * The signature is NOT verified, and here that is correct rather than a corner
 * cut: this token came straight from Google's token endpoint over TLS in the
 * request below, so the channel already proves the issuer, and Google documents
 * that exemption. It would NOT hold for a token posted by a browser — that path
 * needs full JWKS verification, which is why this flow is server-side and that
 * one is not offered at all.
 *
 * `aud` and `iss` are checked anyway: cheap, and they catch a token minted for
 * a different client that somehow reached this code path.
 */
export function readIdToken(
  idToken: string,
  clientId: string,
  now = Date.now(),
): { email: string; name: string } | null {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.aud !== clientId) return null;
  if (!ISSUERS.includes(String(claims.iss))) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  // Unverified means Google is repeating what somebody typed into a form.
  // Linking an account on that is how you hand over a mailbox nobody owned.
  if (claims.email_verified !== true) return null;
  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return null;
  return { email, name: String(claims.name ?? "") };
}

authRouter.get("/v1/auth/google/callback", async (req, res, next) => {
  if (!db) return needDb(res);
  if (!env.googleClientId || !env.googleClientSecret) {
    return bounce(res, "google sign-in is not configured");
  }
  try {
    const sent = readCookie(req.headers.cookie, STATE_COOKIE);
    const got = typeof req.query.state === "string" ? req.query.state : "";
    res.clearCookie(STATE_COOKIE, { path: "/" });

    // Length first: timingSafeEqual THROWS on a length mismatch rather than
    // returning false.
    const a = Buffer.from(sent ?? "");
    const b = Buffer.from(got);
    if (!sent || a.length !== b.length || !timingSafeEqual(a, b)) {
      return bounce(res, "that sign-in link expired — please try again");
    }
    if (typeof req.query.error === "string") return bounce(res, "google sign-in was cancelled");
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return bounce(res, "google sign-in returned nothing");

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return bounce(res, "google would not confirm that sign-in");
    const body = (await tokenRes.json()) as { id_token?: string };
    const claims = body.id_token ? readIdToken(body.id_token, env.googleClientId) : null;
    if (!claims) return bounce(res, "google did not return a verified email address");

    // Link on verified email. Somebody who signed up with a password and later
    // clicks the Google button is the same person, and two accounts would split
    // one company's books in half.
    const [found] = await db.select().from(users).where(eq(users.email, claims.email));
    const user = found ?? (await createAccount(claims.email, claims.name, null));

    const { token, expiresAt } = await createSession(user.id);
    res.cookie(COOKIE, token, cookieOptions(expiresAt));
    res.redirect(`${webUrl()}/runs`);
  } catch (e) {
    next(e);
  }
});
