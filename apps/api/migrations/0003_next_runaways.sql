CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'demo' NOT NULL,
	"seq" bigint NOT NULL,
	"actor_id" uuid,
	"actor_email" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"subject_type" text DEFAULT '' NOT NULL,
	"subject_ref" text DEFAULT '' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text DEFAULT '' NOT NULL,
	"hash" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'demo' NOT NULL,
	"period" text NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'demo' NOT NULL,
	"autonomy_cap_paise" bigint DEFAULT 0 NOT NULL,
	"materiality_paise" bigint DEFAULT 0 NOT NULL,
	"cash_floor_paise" bigint DEFAULT 0 NOT NULL,
	"autonomy_mode" text DEFAULT 'assist' NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"kill_reason" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'demo' NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text DEFAULT '' NOT NULL,
	"signature_ok" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq_uk" ON "audit_log" USING btree ("tenant_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "periods_tenant_uk" ON "periods" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_tenant_uk" ON "policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_uk" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_type_idx" ON "webhook_events" USING btree ("tenant_id","event_type");