-- Functions and triggers carried over from the Supabase schema.
-- Applied after drizzle-kit's generated table DDL: every one of these
-- references a table by name, so the tables must exist first.
--
-- These are not decoration. The .rpc() functions are called directly by
-- services/index.ts, and the triggers fire regardless of which code path
-- inserted the row - which is the whole point of the document_chunks one,
-- since it is the only tenant guard here that application code cannot skip.

-- Resolve canonical identity (follow merge chain). Called via
-- `.rpc("resolve_identity_id", ...)` in services/index.ts.
CREATE OR REPLACE FUNCTION resolve_identity_id(p_identity_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_id UUID := p_identity_id;
  next_id UUID;
BEGIN
  LOOP
    SELECT merged_into_id INTO next_id FROM identities WHERE id = current_id;
    EXIT WHEN next_id IS NULL;
    current_id := next_id;
  END LOOP;
  RETURN current_id;
END;
$$;

-- Given any identity id, return every id whose merge chain transitively
-- terminates at its canonical id (multi-hop aware, unlike a single-level
-- `WHERE merged_into_id = canonical`). Called via
-- `.rpc("identity_merge_chain_ids", ...)`.
CREATE OR REPLACE FUNCTION identity_merge_chain_ids(p_identity_id UUID)
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  canonical_id UUID := resolve_identity_id(p_identity_id);
BEGIN
  RETURN QUERY
  WITH RECURSIVE merge_tree AS (
    SELECT canonical_id AS id
    UNION ALL
    SELECT i.id FROM identities i JOIN merge_tree m ON i.merged_into_id = m.id
  )
  SELECT id FROM merge_tree;
END;
$$;

-- Structural copy of resolve_identity_id for conversations (admin-triggered
-- conversation merge). Called via `.rpc("resolve_conversation_id", ...)`.
CREATE OR REPLACE FUNCTION resolve_conversation_id(p_conversation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_id UUID := p_conversation_id;
  next_id UUID;
BEGIN
  LOOP
    SELECT merged_into_id INTO next_id FROM conversations WHERE id = current_id;
    EXIT WHEN next_id IS NULL;
    current_id := next_id;
  END LOOP;
  RETURN current_id;
END;
$$;

-- Structural copy of identity_merge_chain_ids for conversations. Called via
-- `.rpc("conversation_merge_chain_ids", ...)`.
CREATE OR REPLACE FUNCTION conversation_merge_chain_ids(p_conversation_id UUID)
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  canonical_id UUID := resolve_conversation_id(p_conversation_id);
BEGIN
  RETURN QUERY
  WITH RECURSIVE merge_tree AS (
    SELECT canonical_id AS id
    UNION ALL
    SELECT c.id FROM conversations c JOIN merge_tree m ON c.merged_into_id = m.id
  )
  SELECT id FROM merge_tree;
END;
$$;

-- Brute-force cosine similarity search, scoped by tenant_id. Deliberately no
-- HNSW/IVFFlat index behind this (see cc-schema.ts's document_chunks
-- comment) — an approximate index can silently under-return a small
-- tenant's results once a larger tenant has loaded many chunks, which this
-- feature would never surface as an error. Called via
-- `.rpc("match_document_chunks", ...)`.
CREATE OR REPLACE FUNCTION match_document_chunks(
  p_tenant_id UUID,
  p_query_embedding VECTOR(1536),
  p_match_count INT
)
RETURNS TABLE (id UUID, document_id UUID, heading TEXT, content TEXT, distance FLOAT)
LANGUAGE sql STABLE AS $$
  SELECT id, document_id, heading, content, embedding <=> p_query_embedding AS distance
  FROM document_chunks
  WHERE tenant_id = p_tenant_id AND embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- Keeps conversations.last_message_at current on every new message,
-- regardless of which code path inserted it. (20250620160000)
CREATE OR REPLACE FUNCTION update_conversation_last_message_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation_timestamp
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message_at();

-- Starts/clears the SLA response-due clock on every inbound/outbound
-- external message, funneled through appendMessage's single insert path
-- (10 audited call sites per the original migration's comment) rather than
-- application-layer conditional logic. (20250701001000)
CREATE OR REPLACE FUNCTION update_conversation_response_due_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  window_minutes INTEGER;
BEGIN
  IF NEW.visibility = 'external' AND NEW.direction = 'inbound' THEN
    SELECT COALESCE(default_response_window_minutes, 60) INTO window_minutes
    FROM tenant_settings WHERE tenant_id = NEW.tenant_id;

    UPDATE conversations
    SET response_due_at = NEW.created_at + (COALESCE(window_minutes, 60) || ' minutes')::interval
    WHERE id = NEW.conversation_id AND response_due_at IS NULL;
  ELSIF NEW.visibility = 'external' AND NEW.direction = 'outbound' THEN
    UPDATE conversations
    SET response_due_at = NULL, response_overdue_notified_at = NULL
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation_response_due_at
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_response_due_at();

-- Non-bypassable guard that a chunk's tenant_id can never drift from its
-- parent document's — RLS on document_chunks is decorative for backend code
-- (the service role bypasses it entirely), so this trigger is the only real
-- enforcement. Required by the task explicitly. (20250701001500)
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
