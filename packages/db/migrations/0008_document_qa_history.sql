CREATE TABLE IF NOT EXISTS "document_qa_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "document_qa_history_document_idx"
  ON "document_qa_history" ("document_id");
CREATE INDEX IF NOT EXISTS "document_qa_history_user_document_idx"
  ON "document_qa_history" ("user_id", "document_id");
