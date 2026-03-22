CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."embedding_provider" AS ENUM('openai', 'google-gemini', 'voyage', 'mistral');--> statement-breakpoint
CREATE TYPE "public"."embedding_status" AS ENUM(
  'not_configured',
  'queued',
  'indexing',
  'ready',
  'stale',
  'failed'
);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "embedding_status" "embedding_status" DEFAULT 'not_configured' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "embedding_provider" "embedding_provider";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "embedding_model" varchar(255);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "content_hash" varchar(64);--> statement-breakpoint
UPDATE "document_chunks"
SET "content_hash" = encode(
  digest(
    json_build_object(
      'heading', heading,
      'text', text,
      'pageFrom', page_from,
      'pageTo', page_to,
      'strategyVersion', strategy_version
    )::text,
    'sha256'
  ),
  'hex'
)
WHERE "content_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ALTER COLUMN "content_hash" SET NOT NULL;--> statement-breakpoint
CREATE TABLE "document_chunk_embeddings" (
  "document_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "provider" "embedding_provider" NOT NULL,
  "model" varchar(255) NOT NULL,
  "dimensions" integer NOT NULL,
  "embedding" halfvec(3072) NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_chunk_embeddings_document_id_chunk_index_provider_model_pk" PRIMARY KEY("document_id","chunk_index","provider","model")
);--> statement-breakpoint
ALTER TABLE "document_chunk_embeddings" ADD CONSTRAINT "document_chunk_embeddings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_embedding_status_idx" ON "documents" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX "document_chunk_embeddings_document_idx" ON "document_chunk_embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_chunk_embeddings_provider_model_idx" ON "document_chunk_embeddings" USING btree ("provider","model");--> statement-breakpoint
CREATE INDEX "document_chunk_embeddings_embedding_idx" ON "document_chunk_embeddings" USING hnsw ("embedding" halfvec_cosine_ops);
