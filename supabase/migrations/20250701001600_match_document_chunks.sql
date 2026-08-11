-- Phase 10: brute-force cosine similarity search, scoped by tenant_id.
-- Postgrest's query builder can't order by a `<=>` distance expression, so
-- this needs to be an RPC (same reason resolve_identity_id/etc. are RPCs).
-- No HNSW index behind this - see 20250701001500_rag_documents.sql's header
-- comment for why an exact scan is the deliberate choice at launch.
CREATE OR REPLACE FUNCTION match_document_chunks(p_tenant_id UUID, p_query_embedding VECTOR(1536), p_match_count INT)
RETURNS TABLE (id UUID, document_id UUID, heading TEXT, content TEXT, distance FLOAT)
LANGUAGE sql STABLE AS $$
  SELECT id, document_id, heading, content, embedding <=> p_query_embedding AS distance
  FROM document_chunks
  WHERE tenant_id = p_tenant_id AND embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
