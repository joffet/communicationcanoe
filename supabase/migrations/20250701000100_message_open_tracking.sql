-- Email open-tracking (reside "Notices" integration). Orthogonal to
-- delivery_status - a message can be delivered without being opened, and
-- opened_at is set independently of the delivery_status enum.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
