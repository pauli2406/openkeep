-- GIN index for full-text search acceleration.
-- Uses 'simple' config so the index works as a universal filter regardless
-- of the per-document regconfig used for ranking and snippets.
CREATE INDEX IF NOT EXISTS idx_documents_fulltext_gin
  ON documents USING GIN(to_tsvector('simple', coalesce(full_text, '')));
