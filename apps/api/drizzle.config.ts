import type { Config } from "drizzle-kit";
import { env } from "./src/env.ts";

/**
 * Migrations run against the DIRECT connection. Neon's pooler does not support
 * the session-level operations migrations need. env.ts derives it from
 * DATABASE_URL, so only that one variable has to be set.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.databaseUrlDirect ?? "",
  },
  strict: true,
} satisfies Config;
