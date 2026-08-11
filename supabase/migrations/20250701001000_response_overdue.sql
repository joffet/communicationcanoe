-- Phase 5: response_due_at (added Phase 2, schema-only until now) gets set
-- and cleared by a trigger, not application code - appendMessage is the
-- single funnel for every inbound/outbound message across the whole system
-- (10 audited call sites from Phase 2), and this concern is naturally
-- DB-derived with an existing trigger precedent (update_conversation_last_
-- message_at) to extend rather than adding tenant-settings lookups and
-- conditional-update logic to that hot path.
ALTER TABLE conversations ADD COLUMN response_overdue_notified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION update_conversation_response_due_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  window_minutes INTEGER;
BEGIN
  IF NEW.visibility = 'external' AND NEW.direction = 'inbound' THEN
    -- Only start the clock if not already awaiting a response - a chatty
    -- resident's follow-ups shouldn't push their own deadline back further
    -- than their first unanswered message.
    SELECT COALESCE(default_response_window_minutes, 60) INTO window_minutes
    FROM tenant_settings WHERE tenant_id = NEW.tenant_id;

    UPDATE conversations
    SET response_due_at = NEW.created_at + (COALESCE(window_minutes, 60) || ' minutes')::interval
    WHERE id = NEW.conversation_id AND response_due_at IS NULL;
  ELSIF NEW.visibility = 'external' AND NEW.direction = 'outbound' THEN
    -- An admin reply, an AI auto-reply, or a system send all count as "the
    -- resident got a response" - clear the timer and the notify-once flag.
    UPDATE conversations
    SET response_due_at = NULL, response_overdue_notified_at = NULL
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation_response_due_at
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_response_due_at();
