-- Phase 4b: semantic search upgrade. Run manually when moving beyond full-text:
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS knowledge_documents_embedding_idx
  ON knowledge_documents USING hnsw (embedding vector_cosine_ops);
