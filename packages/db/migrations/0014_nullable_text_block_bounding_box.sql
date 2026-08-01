-- Parse providers that return no line geometry (Mistral OCR emits markdown per page)
-- must be able to store text blocks without a bounding box instead of fabricating one.
ALTER TABLE "document_text_blocks" ALTER COLUMN "bounding_box" DROP NOT NULL;

-- Backfill: every bounding box previously stored for Mistral-parsed documents was
-- fabricated by the old mapper (x:0, y:lineIndex*12, width:len*7) and never reflected
-- real page geometry. Null them out so viewers stop rendering fake highlight regions.
-- Real boxes only come back when a document is reprocessed with a provider that
-- returns geometry.
UPDATE "document_text_blocks" b
SET "bounding_box" = NULL
FROM "documents" d
WHERE b."document_id" = d."id"
  AND d."parse_provider" = 'mistral-ocr';

-- The mapper no longer stores the full OCR response, but documents processed
-- before this deployment still carry it at metadata.parse.providerMetadata.raw.
-- The sanitizer only runs on reprocess, so strip that path here to reclaim the
-- jsonb bloat immediately.
UPDATE "documents"
SET "metadata" = "metadata" #- '{parse,providerMetadata,raw}'
WHERE "parse_provider" = 'mistral-ocr'
  AND "metadata" #> '{parse,providerMetadata,raw}' IS NOT NULL;
