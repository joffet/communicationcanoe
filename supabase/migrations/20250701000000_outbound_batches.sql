-- Bulk-send queue (reside "Notices" integration). A batch fans out to N
-- recipient rows; the realtime-bridge poll worker drains pending recipients
-- and dispatches each through the existing single-send machinery
-- (findOrCreateIdentity -> findOrCreateConversation -> appendMessage ->
-- dispatchOutboundMessage), same as the single-recipient send endpoint.

CREATE TABLE outbound_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  channel message_channel NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  total_recipients INTEGER NOT NULL,
  completed_recipients INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE outbound_batch_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES outbound_batches (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  channel message_channel NOT NULL,
  identity_contact JSONB NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Worker drain query: oldest pending recipients first, across all batches.
CREATE INDEX outbound_batch_recipients_pending_idx
  ON outbound_batch_recipients (created_at) WHERE status = 'pending';
CREATE INDEX outbound_batch_recipients_batch_idx ON outbound_batch_recipients (batch_id);

ALTER TABLE outbound_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_batch_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbound_batches_select_member ON outbound_batches
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY outbound_batch_recipients_select_member ON outbound_batch_recipients
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));
