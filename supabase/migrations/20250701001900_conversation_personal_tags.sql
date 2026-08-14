-- Per-admin "relevant to me" marker (Reside dashboard viewer relevance),
-- distinct from the free-text/shared `tags` table - this is a binary
-- admin-to-conversation association, not a labeled/colored tag, so it gets
-- its own table rather than overloading conversation_tags with a nullable
-- user_id. Same shape/RLS as conversation_assignees, which this is
-- conceptually closest to (a lighter-weight signal short of full assignment).
CREATE TABLE conversation_personal_tags (
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_personal_tags_user_idx ON conversation_personal_tags (user_id);

ALTER TABLE conversation_personal_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_personal_tags_select_member ON conversation_personal_tags
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id IN (SELECT get_user_tenant_ids())
    )
  );
