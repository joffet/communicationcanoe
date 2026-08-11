-- Phase 3: scheduled external-send dispatch needs an atomic "claimed for
-- dispatch" state distinct from queued (so a concurrent cancel request can
-- never race a message that's already being sent), plus a terminal
-- 'canceled' outcome for the admin-triggered cancel action.
ALTER TYPE message_delivery_status ADD VALUE IF NOT EXISTS 'sending';
ALTER TYPE message_delivery_status ADD VALUE IF NOT EXISTS 'canceled';
