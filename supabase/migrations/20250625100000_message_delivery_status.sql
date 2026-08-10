-- Delivery-status tracking for outbound sms/email messages (reside integration).
-- Inbound and web_chat messages leave these columns NULL.
CREATE TYPE message_delivery_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'undelivered');

ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status message_delivery_status;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS messages_provider_message_id_idx
  ON messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
