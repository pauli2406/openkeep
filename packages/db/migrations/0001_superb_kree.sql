CREATE TYPE "public"."review_status" AS ENUM('not_required', 'pending', 'resolved');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_status" "review_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "searchable_pdf_storage_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "last_processing_error" text;--> statement-breakpoint
UPDATE "documents"
SET
  "review_status" = CASE
    WHEN "status" = 'needs_review' THEN 'pending'::"public"."review_status"
    ELSE 'not_required'::"public"."review_status"
  END,
  "review_reasons" = CASE
    WHEN "status" = 'needs_review' AND coalesce("metadata"->>'processingError', '') <> '' THEN '["processing_failed"]'::jsonb
    WHEN "status" = 'needs_review' THEN '["low_confidence"]'::jsonb
    ELSE '[]'::jsonb
  END,
  "last_processing_error" = nullif("metadata"->>'processingError', ''),
  "status" = CASE
    WHEN "status" = 'needs_review' AND coalesce("metadata"->>'processingError', '') <> '' THEN 'failed'
    WHEN "status" = 'needs_review' THEN 'ready'
    ELSE "status"
  END;--> statement-breakpoint
DROP TYPE "public"."document_status";--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."document_status";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DATA TYPE "public"."document_status" USING "status"::"public"."document_status";--> statement-breakpoint
CREATE INDEX "documents_review_status_idx" ON "documents" USING btree ("review_status");
