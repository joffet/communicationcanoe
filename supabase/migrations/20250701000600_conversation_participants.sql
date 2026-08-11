-- Multi-participant conversations (Admin Inbox, Phase 2). Purely additive:
-- conversations.identity_id stays the required "primary" identity, unchanged
-- (same conversations_one_open_per_identity index, same findOrCreateConversation
-- behavior - zero changes to existing inbound/outbound threading). This table
-- is for EXTRA people on a thread: additional internal staff collaborating,
-- or additional external identities CC'd in.
CREATE TABLE conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  identity_id UUID REFERENCES identities (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('external', 'internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((identity_id IS NOT NULL) <> (user_id IS NOT NULL))
);

CREATE UNIQUE INDEX conversation_participants_identity_unique
  ON conversation_participants (conversation_id, identity_id) WHERE identity_id IS NOT NULL;
CREATE UNIQUE INDEX conversation_participants_user_unique
  ON conversation_participants (conversation_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX conversation_participants_conversation_idx ON conversation_participants (conversation_id);

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_participants_select_member ON conversation_participants
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id IN (SELECT get_user_tenant_ids())
    )
  );
