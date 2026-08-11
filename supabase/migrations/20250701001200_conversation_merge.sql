-- Phase 7: admin-triggered conversation merging. Mirrors the existing
-- identity-merge pattern (identities.merged_into_id / resolve_identity_id /
-- identity_merge_chain_ids) exactly, so it stays low-risk and consistent:
-- messages are never rewritten, only conversations.merged_into_id points at
-- the canonical target, and reads walk the chain.

ALTER TABLE conversations ADD COLUMN merged_into_id UUID REFERENCES conversations (id) ON DELETE SET NULL;

-- The enum-add and its first real usage (in application code, not this
-- migration) land in separate transactions, matching the precedent set by
-- 20250701000800_message_scheduled_send_statuses.sql's 'sending'/'canceled'
-- additions to message_delivery_status - no same-transaction Postgres
-- sequencing concern applies here.
ALTER TYPE conversation_status ADD VALUE IF NOT EXISTS 'merged';

-- Resolve canonical conversation (follow merge chain) - structural copy of
-- resolve_identity_id (20250620160000_initial_schema.sql).
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

-- Given any conversation id, return every id (including the canonical one
-- itself) whose merge chain transitively terminates at its canonical id -
-- structural copy of identity_merge_chain_ids (20250701000900_identity_merge_chain.sql).
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
