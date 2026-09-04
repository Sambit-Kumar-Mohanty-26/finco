ALTER TABLE "datasets" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_content_uk" ON "datasets" USING btree ("tenant_id","content_hash");