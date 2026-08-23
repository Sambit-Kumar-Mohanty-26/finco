CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'demo' NOT NULL,
	"period" text NOT NULL,
	"input_hash" text NOT NULL,
	"state" text DEFAULT 'INGESTED' NOT NULL,
	"total_rows" bigint DEFAULT 0 NOT NULL,
	"matched_rows" bigint DEFAULT 0 NOT NULL,
	"unproven_paise" bigint DEFAULT 0 NOT NULL,
	"stages" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "runs_tenant_period_idx" ON "runs" USING btree ("tenant_id","period");