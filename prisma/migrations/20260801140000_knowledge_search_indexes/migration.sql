-- Knowledge retrieval: full-text + trigram search in the database.
-- Arabic has no stemmer in core Postgres, so 'simple' (tokenize, no stemming)
-- is the correct config here — pairing it with trigram similarity recovers the
-- fuzzy matching a stemmer would otherwise provide.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- generated tsvector so ranking happens in the query planner, not in JS
ALTER TABLE "knowledge_documents"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;

CREATE INDEX IF NOT EXISTS "knowledge_documents_content_tsv_idx"
  ON "knowledge_documents" USING GIN ("content_tsv");

CREATE INDEX IF NOT EXISTS "knowledge_documents_content_trgm_idx"
  ON "knowledge_documents" USING GIN ("content" gin_trgm_ops);

-- lead/unit lookup for the ⌘K palette
CREATE INDEX IF NOT EXISTS "leads_full_name_trgm_idx"
  ON "leads" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "units_unit_number_trgm_idx"
  ON "units" USING GIN ("unitNumber" gin_trgm_ops);
