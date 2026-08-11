-- Internal vs external message visibility (Admin Inbox, Phase 2).
-- Column default is 'internal' to match the future compose-UI default
-- ("internal only unless an admin takes the extra step to go external") -
-- but every message-writing code path that exists TODAY represents a message
-- that already reached (or came from) the customer, so every existing
-- appendMessage call site is updated in this same phase to pass
-- visibility: 'external' explicitly rather than rely on the new default.
CREATE TYPE message_visibility AS ENUM ('internal', 'external');

ALTER TABLE messages ADD COLUMN visibility message_visibility NOT NULL DEFAULT 'internal';
ALTER TABLE messages ADD COLUMN scheduled_send_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN ai_review_status TEXT CHECK (ai_review_status IN ('pending', 'approved', 'flagged'));

ALTER TABLE tenant_settings ADD COLUMN external_send_delay_seconds INTEGER NOT NULL DEFAULT 60;
