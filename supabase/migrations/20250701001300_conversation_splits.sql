-- Phase 8: admin-triggered conversation splitting (foundational/manual layer
-- only - the AI-automated routing layer that decides where new inbound
-- messages go once 2+ open conversations exist for a resident is deferred
-- to a future phase). Unlike merge (many conversations -> one, messages left
-- in place and read via a chain-walk), split is one conversation -> many:
-- messages from the split point onward are physically moved into a new
-- conversation, since the moved set is typically small/recent and the UX
-- goal is that the new conversation visibly contains the message that
-- started the new topic.

-- This table is both an audit trail (mirrors identity_merge_logs' shape -
-- matched_on/merged_by/merged_by_user_id - for the same reason Phase 6
-- established: admins need to see *why*, not just *that*, something
-- happened) and, indirectly, the mechanism other code can use to discover
-- "this conversation had messages split out of it" (e.g. the widget-resume
-- follow fix). trigger_type/reasoning are written as 'admin'/null this
-- phase - the columns exist now so the deferred AI-automated layer doesn't
-- need its own migration later.
CREATE TABLE conversation_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source_conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  target_conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  split_message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('admin', 'ai')),
  triggered_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX conversation_splits_source_idx ON conversation_splits (source_conversation_id);
CREATE INDEX conversation_splits_target_idx ON conversation_splits (target_conversation_id);

-- Splitting requires two simultaneously-open conversations for the same
-- identity, which this index has forbidden since Phase 0. comm-canoe is
-- pre-production and its schema is freely redesignable (see this repo's
-- other migrations' operating assumption) - dropped outright rather than
-- narrowed to a partial index, since the "one open conversation per
-- resident" invariant this protected is no longer universally true by
-- design. Phase 7's updateConversationStatus special-cased a unique-
-- violation on this exact index name (reopening a resolved conversation
-- when the resident already had a different open one) - that catch is
-- removed in application code alongside this migration, since multi-open
-- is now an intentional, supported state, not a bug.
DROP INDEX conversations_one_open_per_identity;
