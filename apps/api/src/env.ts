import { fileURLToPath } from "node:url";

/**
 * Environment, validated once at boot.
 *
 * DATABASE_URL is deliberately optional so the service starts and /health
 * answers honestly before Neon exists — P0 should be able to prove the HTTP
 * path works on its own, and a missing database should be a reported status,
 * not a crash loop.
 */

/**
 * Neon exposes one connection string, but two are needed: the pooled host for
 * request-path queries, and the direct host for migrations and pg-boss, whose
 * session-level work (LISTEN in particular) misbehaves through the pooler.
 * The only difference is the "-pooler" suffix on the host, so derive it rather
 * than asking for the same secret twice and risking the two drifting apart.
 */
// Local dev reads apps/api/.env. Resolved relative to this file, not to cwd,
// because drizzle-kit, tsx and pnpm each run from a different directory. On
// Render the platform injects the real values and no file exists, so the throw
// is the expected path there. loadEnvFile is built into Node — no dotenv.
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // no .env — production, or the values are already in the environment
}
// Note: loadEnvFile does not clobber variables that are already set, so a real
// exported value always beats the file. Verified, not assumed.

function direct(url: string | null): string | null {
  return url && url.replace("-pooler.", ".");
}

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? null,
  databaseUrlDirect:
    process.env.DATABASE_URL_UNPOOLED ?? direct(process.env.DATABASE_URL ?? null),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  // Optional on purpose: T5 is the last tier and the only one that costs money.
  // Without a key the run still closes — five deterministic tiers and a smaller
  // auto-match rate — which is what keeps CI and local dev free and offline.
  geminiApiKey: process.env.GEMINI_API_KEY ?? null,
  // Signs session cookies. Absent in dev, where a random per-boot value is fine
  // because logging in again is cheaper than a secret nobody rotated.
  sessionSecret: process.env.SESSION_SECRET ?? null,
  // Render, Vercel and GitHub Actions each expose the commit under a different name
  gitSha:
    process.env.RENDER_GIT_COMMIT ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    "local",
  nodeEnv: process.env.NODE_ENV ?? "development",
};
