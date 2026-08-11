-- Phase 6: stores *why* the tone-review AI task flagged (or approved) a
-- message, alongside the existing ai_review_status (Phase 2) - an admin
-- deciding whether to override a flagged message needs to see the reasoning,
-- not just the verdict.
ALTER TABLE messages ADD COLUMN ai_review_reasoning TEXT;
