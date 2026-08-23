import pino from "pino";
import { env } from "./env.ts";

export const log = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  // structured in production, readable locally
  transport:
    env.nodeEnv === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});
