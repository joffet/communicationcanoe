-- Web chat channel
ALTER TYPE message_channel ADD VALUE IF NOT EXISTS 'web_chat';

-- Tenant widget key
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chat_widget_key TEXT;
UPDATE tenants SET chat_widget_key = gen_random_uuid()::text WHERE chat_widget_key IS NULL;
ALTER TABLE tenants ALTER COLUMN chat_widget_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_chat_widget_key_unique ON tenants (chat_widget_key);

-- Anonymous identities for web chat
ALTER TABLE identities ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_contact_required;
ALTER TABLE identities ADD CONSTRAINT identities_contact_required
  CHECK (phone IS NOT NULL OR email IS NOT NULL OR is_anonymous = true);

-- Identity conversion audit log
CREATE TABLE IF NOT EXISTS identity_conversion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  identity_id UUID NOT NULL REFERENCES identities (id) ON DELETE CASCADE,
  converted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_by merge_actor NOT NULL DEFAULT 'system',
  converted_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  captured_name TEXT,
  captured_email TEXT,
  captured_phone TEXT
);

CREATE INDEX IF NOT EXISTS identity_conversion_logs_tenant_idx ON identity_conversion_logs (tenant_id);
CREATE INDEX IF NOT EXISTS identity_conversion_logs_identity_idx ON identity_conversion_logs (identity_id);

-- Live transfer (renamed from call_transfers)
CREATE TYPE live_transfer_channel AS ENUM ('voice', 'web_chat');

ALTER TYPE call_transfer_outcome RENAME TO live_transfer_outcome;
ALTER TYPE live_transfer_outcome ADD VALUE IF NOT EXISTS 'pending';

ALTER TABLE call_transfers RENAME TO live_transfers;

ALTER TABLE live_transfers ADD COLUMN IF NOT EXISTS channel live_transfer_channel NOT NULL DEFAULT 'voice';

ALTER TABLE live_transfers ALTER COLUMN attempted_user_id DROP NOT NULL;

-- RLS for new/renamed tables
ALTER TABLE identity_conversion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_transfers_select_member ON live_transfers;

CREATE POLICY live_transfers_select_member ON live_transfers
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY identity_conversion_logs_select ON identity_conversion_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));
