-- Per-user read tracking (Reside dashboard unread counts). One cursor row
-- per (conversation, user) - last_read_message_id/last_read_at describe the
-- newest message the user had seen as of their last "mark read" call. No row
-- means fully unread, including for a user who has never opened the thread.
-- Written against the canonical conversation id only (see
-- conversation_merge.sql's chain-aware pattern) - moved on merge alongside
-- tags/assignees/participants rather than left to key against a
-- merged-away id.
CREATE TABLE conversation_read_states (
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_read_states_user_idx ON conversation_read_states (user_id);

ALTER TABLE conversation_read_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_read_states_select_member ON conversation_read_states
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id IN (SELECT get_user_tenant_ids())
    )
  );
