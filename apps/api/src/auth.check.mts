import assert from "node:assert/strict";
import { hashPassword, readCookie, requireRole, verifyPassword, type Actor } from "./auth.ts";
import { readIdToken } from "./routes/auth.ts";

// --- password hashing ---------------------------------------------------------
const hash = await hashPassword("correct horse battery staple");
assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/, "unexpected stored format");
assert.ok(!hash.includes("correct horse"), "the password itself must not be recoverable");
assert.equal(await verifyPassword("correct horse battery staple", hash), true);
assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
assert.equal(await verifyPassword("", hash), false);

// The same password twice gives two different hashes: the salt is per-user, so
// a leaked table cannot be attacked once for every account that shares a
// password.
const again = await hashPassword("correct horse battery staple");
assert.notEqual(hash, again, "the salt is not random");

// A malformed or absent stored hash is false, never a throw and never true —
// a login route must not 500 on a corrupted row, and must not let it through.
for (const bad of ["", "plaintext", "bcrypt$x$y", "scrypt$$", "scrypt$zz$zz"]) {
  assert.equal(await verifyPassword("anything", bad), false, `${bad} was accepted`);
}

// --- cookie parsing -----------------------------------------------------------
assert.equal(readCookie("finco_session=abc123", "finco_session"), "abc123");
assert.equal(readCookie("a=1; finco_session=abc123; b=2", "finco_session"), "abc123");
assert.equal(readCookie(" finco_session = spaced ", "finco_session"), "spaced");
assert.equal(readCookie("finco_session=a%3Db", "finco_session"), "a=b", "value not URL-decoded");
assert.equal(readCookie(undefined, "finco_session"), null);
assert.equal(readCookie("other=1", "finco_session"), null);
// A prefix must not match: xfinco_session is a different cookie an attacker
// can set from a sibling subdomain.
assert.equal(readCookie("xfinco_session=evil", "finco_session"), null);
assert.equal(readCookie("finco_session_x=evil", "finco_session"), null);
// A base64url token contains "=" only as padding-free content, but the parser
// must still split on the FIRST "=" or a token is silently truncated.
assert.equal(readCookie("finco_session=a=b=c", "finco_session"), "a=b=c");

// --- role gate ----------------------------------------------------------------
type Res = { code: number; body: unknown };
const run = (min: Parameters<typeof requireRole>[0], actor?: Actor): Res | "next" => {
  let out: Res | "next" = "next";
  const res = {
    status(code: number) {
      return {
        json(body: unknown) {
          out = { code, body };
          return body;
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireRole(min)({ actor } as any, res as any, () => {});
  return out;
};

const viewer: Actor = { id: "1", tenantId: "demo", email: "v@x.com", name: "V", role: "viewer" };
const preparer: Actor = { ...viewer, role: "preparer" };
const approver: Actor = { ...viewer, role: "approver" };

assert.deepEqual((run("preparer") as Res).code, 401, "an anonymous request must be 401, not 403");
assert.equal((run("preparer", viewer) as Res).code, 403);
assert.equal(run("preparer", preparer), "next");
assert.equal(run("preparer", approver), "next", "an approver outranks a preparer");
assert.equal((run("approver", preparer) as Res).code, 403, "a preparer must not approve");
assert.equal(run("viewer", viewer), "next");

// An unknown role is refused rather than defaulting to something permissive.
assert.equal((run("viewer", { ...viewer, role: "admin" as Actor["role"] }) as Res).code, 403);

// --- google id tokens ---------------------------------------------------------
//
// The signature is not checked (the token arrives over TLS straight from
// Google's token endpoint), so EVERY other claim has to be, and this is the
// only thing standing between a stray token and a session.

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = 1_800_000_000_000;

const jwt = (claims: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

const good = {
  aud: CLIENT,
  iss: "https://accounts.google.com",
  exp: Math.floor(NOW / 1000) + 3600,
  email: "Priya@Example.com",
  email_verified: true,
  name: "Priya",
};

assert.deepEqual(readIdToken(jwt(good), CLIENT, NOW), { email: "priya@example.com", name: "Priya" },
  "a good token must parse, and the email must be lowercased for the unique index");
assert.deepEqual(readIdToken(jwt({ ...good, iss: "accounts.google.com" }), CLIENT, NOW)?.email,
  "priya@example.com", "google issues both spellings of iss");

// Each of these is a real attack, not a malformed-input case.
const refuse: [string, string][] = [
  [jwt({ ...good, aud: "999.apps.googleusercontent.com" }), "a token minted for another client"],
  [jwt({ ...good, iss: "accounts.google.com.evil.test" }), "a lookalike issuer"],
  [jwt({ ...good, email_verified: false }), "an unverified email — the account-takeover path"],
  [jwt({ ...good, email_verified: "true" }), "a string that is not the boolean true"],
  [jwt({ ...good, exp: Math.floor(NOW / 1000) - 1 }), "an expired token"],
  [jwt({ ...good, exp: "9999999999" }), "an exp that is not a number"],
  [jwt({ ...good, email: "" }), "no email at all"],
  [jwt({ ...good, email: "not-an-address" }), "an email with no @"],
  ["", "an empty string"],
  ["a.b", "too few segments"],
  ["a.b.c.d", "too many segments"],
  ["a.!!!.c", "a payload that is not JSON"],
];
for (const [token, why] of refuse) {
  assert.equal(readIdToken(token, CLIENT, NOW), null, `accepted ${why}`);
}

console.log(
  "auth: scrypt round-trips, salts differ, cookies parse exactly, roles rank viewer<preparer<approver; " +
    "the google token check refuses a foreign aud, a lookalike issuer, an unverified email and an expired exp",
);
