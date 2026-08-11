-- Conversation tags (Admin Inbox, Phase 2).
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE conversation_tags (
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE INDEX tags_tenant_idx ON tags (tenant_id);
CREATE INDEX conversation_tags_tag_idx ON conversation_tags (tag_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_select_member ON tags
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY conversation_tags_select_member ON conversation_tags
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id IN (SELECT get_user_tenant_ids())
    )
  );
