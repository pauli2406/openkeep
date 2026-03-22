CREATE TYPE "public"."parse_provider" AS ENUM(
  'local-ocr',
  'google-document-ai-enterprise-ocr',
  'google-document-ai-gemini-layout-parser',
  'amazon-textract',
  'azure-ai-document-intelligence',
  'mistral-ocr'
);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "parse_provider" "parse_provider";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "chunk_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "heading" text,
  "text" text NOT NULL,
  "page_from" integer,
  "page_to" integer,
  "strategy_version" varchar(64) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_parse_provider_idx" ON "documents" USING btree ("parse_provider");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_chunk_idx" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("document_id");
