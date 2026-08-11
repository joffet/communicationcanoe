-- Phase 9: AI-automated conversation routing. This is the layer that
-- decides, without an admin's hand, where a new inbound message should land
-- once 2+ open conversations exist for a resident (or a lone one has gone
-- quiet long enough to plausibly be a new topic) - deferred out of Phase 8,
-- which only built the manual/admin-triggered split action.
--
-- findOrCreateConversation (packages/database/src/services/index.ts) never
-- got updated when Phase 8 dropped conversations_one_open_per_identity - it
-- still does .eq("status","open").maybeSingle(), which throws the instant
-- an identity has 2+ open conversations, a state Phase 8 itself made
-- possible. This migration's index restores the query-serving role the
-- dropped unique index also played, minus the uniqueness constraint itself.

-- Three-state machine, not a plain pending/null flag: a design-review pass
-- found the dangerous side effect here (splitConversation, non-idempotent)
-- has to happen *before* any "done" write, unlike Phase 6's tone-review
-- (whose only side effect IS the final write, so a check-only-on-write is
-- safe there). 'processing' is the atomic claim state, mirroring the exact
-- pattern already used for claimScheduledMessage/claimOverdueConversationNotification.
ALTER TABLE messages ADD COLUMN topic_check_status TEXT CHECK (topic_check_status IN ('pending', 'processing', 'reviewed'));

CREATE INDEX conversations_tenant_identity_open_idx ON conversations (tenant_id, identity_id) WHERE status = 'open';

-- Default is deliberately conservative (24h, not the originally-sketched
-- 3h) - multi-hour gaps between messages are the normal shape of this kind
-- of communication (resident emails about a leak, gets a reply, doesn't
-- check back until evening), and this check applies even to the
-- single-open-conversation case, not just post-split identities. A short
-- default would flag a large fraction of ordinary reawakenings for an AI
-- check on every tenant from day one.
ALTER TABLE tenant_settings ADD COLUMN conversation_staleness_minutes INTEGER NOT NULL DEFAULT 1440;
