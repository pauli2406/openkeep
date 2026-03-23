ALTER TABLE "correspondents"
  ADD COLUMN "summary" text,
  ADD COLUMN "summary_generated_at" timestamp with time zone;
