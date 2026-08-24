CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"value_date" date NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"debit_paise" bigint DEFAULT 0 NOT NULL,
	"charges_paise" bigint DEFAULT 0 NOT NULL,
	"narration" text NOT NULL,
	"bank" text DEFAULT 'HDFC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'demo' NOT NULL,
	"name" text NOT NULL,
	"period" text NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"order_receipt" text NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"invoice_date" date NOT NULL,
	"customer" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"verdict" text NOT NULL,
	"left_type" text NOT NULL,
	"left_ref" text NOT NULL,
	"right_type" text NOT NULL,
	"right_ref" text NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"delta_paise" bigint DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"settlement_ref" text,
	"type" text NOT NULL,
	"entity_id" text NOT NULL,
	"order_id" text,
	"payment_id" text,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"debit_paise" bigint DEFAULT 0 NOT NULL,
	"fee_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"dispute_id" text,
	"on_hold" boolean DEFAULT false NOT NULL,
	"description" text,
	"captured_on" date
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"utr" text,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"fee_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"settled_on" date NOT NULL,
	"on_hold" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'processed' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "dataset_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_invoices" ADD CONSTRAINT "erp_invoices_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_links" ADD CONSTRAINT "match_links_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_rows" ADD CONSTRAINT "recon_rows_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_lines_dataset_idx" ON "bank_lines" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "bank_lines_date_idx" ON "bank_lines" USING btree ("dataset_id","value_date");--> statement-breakpoint
CREATE INDEX "erp_invoices_dataset_idx" ON "erp_invoices" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "erp_invoices_receipt_idx" ON "erp_invoices" USING btree ("dataset_id","order_receipt");--> statement-breakpoint
CREATE INDEX "match_links_run_idx" ON "match_links" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "match_links_left_idx" ON "match_links" USING btree ("run_id","left_type","left_ref");--> statement-breakpoint
CREATE INDEX "recon_rows_dataset_idx" ON "recon_rows" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "recon_rows_settlement_idx" ON "recon_rows" USING btree ("dataset_id","settlement_ref");--> statement-breakpoint
CREATE INDEX "recon_rows_order_idx" ON "recon_rows" USING btree ("dataset_id","order_id");--> statement-breakpoint
CREATE INDEX "settlements_dataset_idx" ON "settlements" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "settlements_utr_idx" ON "settlements" USING btree ("dataset_id","utr");--> statement-breakpoint
CREATE INDEX "settlements_ref_idx" ON "settlements" USING btree ("dataset_id","ref");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;