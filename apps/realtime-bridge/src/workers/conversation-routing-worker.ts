import { createDomainService } from "@communication-canoe/database";
import { classifyTopicShift } from "@communication-canoe/shared/ai";
import { startPollLoop } from "./poll-loop.js";

const POLL_INTERVAL_MS = 30_000;
/** The widest ceiling here, matching the "no hard deadline" note below: a
 * topic split is a tidying operation, and five minutes late is invisible. */
const IDLE_POLL_INTERVAL_MS = 300_000;
const BATCH_LIMIT = 25;
const PRIOR_MESSAGE_CONTEXT_LIMIT = 10;
const AI_SPLIT_CIRCUIT_BREAKER_LIMIT = 10;
const AI_SPLIT_CIRCUIT_BREAKER_WINDOW_MINUTES = 60;
/** How long a claimed ("processing") message may sit unresolved before a later
 * tick assumes the claiming replica died. Well above one classify - a single
 * AI call, seconds - so a slow-but-alive check is never retired underneath
 * itself. Matches outbound-batch-worker's STUCK_CLAIM_TIMEOUT_MS. */
const STUCK_CLAIM_TIMEOUT_MS = 5 * 60_000;

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
  startPollLoop({
    name: "conversation-routing-worker",
    activeIntervalMs: POLL_INTERVAL_MS,
    idleIntervalMs: IDLE_POLL_INTERVAL_MS,
    tick: reviewPendingTopicChecks,
  });
}

async function reviewPendingTopicChecks(): Promise<boolean> {
  const domain = createDomainService();

  // Retire anything a dead replica left claimed. Retire, not requeue: a topic
  // check does not keep its meaning the way an unsent recipient does, and
  // splitConversation sweeps every message from the claimed one's created_at
  // onward - so replaying a long-stranded row would move weeks of unrelated
  // later history, not just re-decide one message. See
  // cancelStrandedTopicChecks for the whole argument.
  //
  // Before the listPending* below, in all three workers, because the two that
  // requeue put the row back at 'pending' where the same tick then finds it -
  // so a reclaim reports work and holds the fast interval, rather than
  // backing off with something newly runnable sitting there.
  //
  // This does mean one extra statement per tick, including idle ones, which
  // is the cadence the poll-loop backoff just cut. It has to be: a stranded
  // claim is by definition what is left when there is no pending work, so
  // gating the sweep on finding work would stop it ever running. The cost is
  // an index-only probe of a partial index that is empty almost always -
  // roughly 1.7k statements a day against the 46k that backoff removed.
  const cancelled = await domain.cancelStrandedTopicChecks(
    new Date(Date.now() - STUCK_CLAIM_TIMEOUT_MS).toISOString(),
  );
  if (cancelled > 0) {
    console.log(
      `[conversation-routing-worker] retired ${cancelled} stranded topic check(s) without classifying`,
    );
  }

  const ids = await domain.listPendingTopicCheckMessageIds(BATCH_LIMIT);
  if (ids.length === 0) return false;

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

  return true;
}
