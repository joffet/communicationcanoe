-- Ticketing/SLA fields (Admin Inbox, Phase 2). Schema only - the "scan for
-- overdue conversations and notify reside" job is Phase 5's job; this phase
-- just lands the columns + manual setters so that job has something to scan.
CREATE TYPE conversation_priority AS ENUM ('low', 'normal', 'high', 'urgent');

ALTER TABLE conversations ADD COLUMN priority conversation_priority NOT NULL DEFAULT 'normal';
ALTER TABLE conversations ADD COLUMN response_due_at TIMESTAMPTZ;

ALTER TABLE tenant_settings ADD COLUMN default_response_window_minutes INTEGER NOT NULL DEFAULT 60;

CREATE INDEX conversations_response_due_idx ON conversations (response_due_at) WHERE response_due_at IS NOT NULL;
