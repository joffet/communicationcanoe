import { createDomainService } from "@communication-canoe/database";
import { classifyTopicShift } from "@communication-canoe/shared/ai";

const POLL_INTERVAL_MS = 30_000;
const BATCH_LIMIT = 25;
const PRIOR_MESSAGE_CONTEXT_LIMIT = 10;
const AI_SPLIT_CIRCUIT_BREAKER_LIMIT = 10;
const AI_SPLIT_CIRCUIT_BREAKER_WINDOW_MINUTES = 60;

/**
 * Phase 9: the async half of AI-automated conversation routing. The
 * synchronous fast path (DomainService.findOrCreateConversation) flags a
 * message `topic_check_status: 'pending'` when it landed in a conversation
 * that had gone quiet past the tenant's staleness threshold - this worker
 * examines those messages and, if the AI classifier judges the message a
 * genuinely different topic, splits it off into its own conversation
 * (reusing Phase 8's splitConversation, trigger_type: 'ai'). No hard
 * deadline (unlike tone-review-worker's 60s-send-delay constraint), hence
 * a longer poll interval.
 *
 * Claims each message atomically before classifying it - unlike
 * tone-review (whose only side effect IS its final write, so a
 * check-only-on-write is safe there), the dangerous side effect here
 * (splitConversation, non-idempotent) happens *before* any "done" write,
 * so a check-only-on-final-write wouldn't stop two overlapping ticks from
 * both acting on the same message. Found by a design-review pass, not by
 * testing.
 */
export function startConversationRoutingWorker(): void {
  setInterval(() => {
    void reviewPendingTopicChecks().catch((err) => {
      console.error("[conversation-routing-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[conversation-routing-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function reviewPendingTopicChecks(): Promise<void> {
  const domain = createDomainService();

  const ids = await domain.listPendingTopicCheckMessageIds(BATCH_LIMIT);
  if (ids.length === 0) return;

  console.log(`[conversation-routing-worker] ${ids.length} message(s) awaiting topic check`);

  for (const id of ids) {
    try {
      const claimed = await domain.claimTopicCheckMessage(id);
      if (!claimed) continue; // another tick already claimed it

      const thread = await domain.getConversationThread(claimed.conversationId);
      if (!thread) {
        await domain.markTopicCheckReviewed(id);
        continue;
      }

      const priorMessages = thread.messages
        .filter((m) => m.id !== id)
        .slice(-PRIOR_MESSAGE_CONTEXT_LIMIT)
        .map((m) => ({ direction: m.direction, body: m.body }));

      const result = await classifyTopicShift({ newMessageBody: claimed.body, priorMessages });

      if (result.isNewTopic) {
        // Cheap circuit breaker - checked before acting, not a defensive
        // guard elsewhere. A wrong *individual* auto-split is cheap to fix
        // via merge, but nothing else surfaces "the classifier is
        // over-triggering on this tenant" - this caps the blast radius of
        // a systematic misfire.
        const recentAiSplits = await domain.countRecentAiSplits(
          claimed.tenantId,
          AI_SPLIT_CIRCUIT_BREAKER_WINDOW_MINUTES,
        );
        if (recentAiSplits >= AI_SPLIT_CIRCUIT_BREAKER_LIMIT) {
          console.warn(
            `[conversation-routing-worker] circuit breaker tripped for tenant ${claimed.tenantId} ` +
              `(${recentAiSplits} AI splits in the last ${AI_SPLIT_CIRCUIT_BREAKER_WINDOW_MINUTES}m) - ` +
              `skipping split for message ${id}`,
          );
        } else {
          // splitConversation re-resolves conversation_id to canonical
          // itself and sweeps every message from this one's created_at
          // onward - correctly cascades if a later message already landed
          // here while this one sat pending/processing.
          await domain.splitConversation(claimed.tenantId, claimed.conversationId, id, null, {
            triggerType: "ai",
            reasoning: result.reasoning,
          });
        }
      }

      await domain.markTopicCheckReviewed(id);
    } catch (err) {
      console.error(`[conversation-routing-worker] message ${id} failed:`, err);
      // Stay together on any failure - the conservative direction here is
      // the *opposite* of tone-review's default-to-flagged: an
      // unclassifiable message should stay where the fast path already put
      // it, not proliferate a new conversation. Still must clear
      // processing -> reviewed so it isn't stuck forever.
      await domain.markTopicCheckReviewed(id).catch((innerErr) => {
        console.error(`[conversation-routing-worker] failed to record failure for ${id}:`, innerErr);
      });
    }
  }
}
