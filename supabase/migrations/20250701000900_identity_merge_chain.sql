-- Phase 4: resident-facing read paths need to resolve "all conversations for
-- this identity, including ones created under an id that later merged into
-- it" - resolve_identity_id only walks forward (given any id, find the
-- current canonical one). This is the reverse: given a canonical id, find
-- every id whose merge chain transitively terminates at it, so a
-- single-level `WHERE merged_into_id = canonical` (which misses multi-hop
-- chains like A -> B -> C) is never relied on.
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
