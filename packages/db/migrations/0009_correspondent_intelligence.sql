ALTER TABLE "correspondents"
  ADD COLUMN IF NOT EXISTS "intelligence" jsonb,
  ADD COLUMN IF NOT EXISTS "intelligence_generated_at" timestamp with time zone;
