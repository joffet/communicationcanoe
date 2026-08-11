-- Phase 10: AI intermediate reply (real RAG). Admin-uploaded knowledge
-- documents (reside extracts text and sends it here - comm-canoe never
-- touches raw files or S3, matching this repo's zero-AWS-SDK-beyond-SES
-- footprint) are chunked and embedded asynchronously by a new realtime-bridge
-- worker, then retrieved via similarity search to inform suggestReply drafts.
--
-- No HNSW index here deliberately: HNSW is approximate, and a query like
-- `WHERE tenant_id = X ORDER BY embedding <=> $1 LIMIT k` can find the global
-- top-k across all tenants first and post-filter, silently under-returning
-- (or zero-returning) results for a small tenant once a larger tenant has
-- loaded many chunks - a completeness bug this feature would never surface
-- as an error, and worse than a typical cross-tenant leak (another tenant's
-- text quietly woven into a real reply). At expected v1 volumes (dozens-low
-- hundreds of chunks/tenant) an exact brute-force scan is correct by
-- construction and the latency cost is negligible. Add an index later, with
-- its own dedicated cross-tenant completeness test, only if volume actually
-- threatens query latency.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_text TEXT NOT NULL,
  extractor TEXT NOT NULL,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  failure_reason TEXT,
  uploaded_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenant_id is denormalized from documents (never accepted as pass-through
-- input - always derived server-side from the parent document at insert
-- time) so every retrieval query can filter by it directly without a join,
-- and the trigger below asserts the two can never drift apart.
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX documents_tenant_idx ON documents (tenant_id);
CREATE INDEX document_chunks_tenant_idx ON document_chunks (tenant_id);
CREATE INDEX document_chunks_document_idx ON document_chunks (document_id);

-- Defense-in-depth: RLS on these tables (added below) is decorative for
-- backend code paths, since DomainService uses the service-role key and
-- bypasses RLS entirely - this trigger is a real, non-bypassable guard
-- against a chunk ever landing under the wrong tenant.
CREATE OR REPLACE FUNCTION assert_chunk_tenant_matches_document()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id != (SELECT tenant_id FROM documents WHERE id = NEW.document_id) THEN
    RAISE EXCEPTION 'document_chunks.tenant_id must match parent document tenant_id';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_chunks_tenant_check
  BEFORE INSERT ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION assert_chunk_tenant_matches_document();

-- Unattended-cost surface: unlike suggestReply's existing per-click cost,
-- document ingestion runs from a background worker, so an uncapped tenant
-- could drive unbounded embedding-API spend. Enforced at ingestion-accept
-- time in both reside and comm-canoe (defense in depth).
ALTER TABLE tenant_settings ADD COLUMN max_knowledge_documents INTEGER NOT NULL DEFAULT 50;
ALTER TABLE tenant_settings ADD COLUMN max_knowledge_chunks INTEGER NOT NULL DEFAULT 5000;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_select_member ON documents
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY document_chunks_select_member ON document_chunks
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));
