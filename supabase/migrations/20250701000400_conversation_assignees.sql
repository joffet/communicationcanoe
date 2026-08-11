-- Multi-assignee support (Admin Inbox, Phase 2). Additive - conversations.assigned_user_id
-- / assigned_team_id stay exactly as-is (still the "primary" assignee/team via
-- assignConversationUser/assignConversationTeam); this table is for who else
-- is on the conversation besides the primary assignee.
CREATE TABLE conversation_assignees (
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_assignees_user_idx ON conversation_assignees (user_id);

ALTER TABLE conversation_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_assignees_select_member ON conversation_assignees
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id IN (SELECT get_user_tenant_ids())
    )
  );
