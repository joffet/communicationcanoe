-- Repeated-failure -> resident-record flag (reside "Notices" integration).
-- Per-channel consecutive-failure counters on identities; a tenant-configurable
-- threshold (tenant_settings.bounce_threshold) decides when to notify reside so
-- it can flag the resident's contact info as undeliverable.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS email_consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS phone_consecutive_failures INTEGER NOT NULL DEFAULT 0;
-- Set once the threshold is crossed, so reside is notified once per failure
-- streak rather than on every subsequent failure past the threshold. Cleared
-- (along with the counter) on the next successful delivery.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS email_flagged_at TIMESTAMPTZ;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS phone_flagged_at TIMESTAMPTZ;

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS bounce_threshold INTEGER NOT NULL DEFAULT 3;
