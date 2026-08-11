import { createDomainService } from "@communication-canoe/database";
import { reviewMessageTone } from "@communication-canoe/shared/ai";

const POLL_INTERVAL_MS = 5_000;
const BATCH_LIMIT = 25;
const RECENT_MESSAGE_CONTEXT_LIMIT = 10;

/**
 * Reviews every external message an admin composes (Phase 3's compose
 * endpoint queues them with ai_review_status: 'pending') before Phase 3's
 * scheduled-message-worker is allowed to dispatch it - that worker's
 * listDueScheduledMessageIds/claimScheduledMessage both now also require
 * ai_review_status = 'approved'. Must complete well inside the send delay
 * (default 60s), hence the same tight poll interval as that worker.
 * Structured identically to it - same poll shape, same "single instance, no
 * distributed coordination" risk acceptance.
 */
export function startToneReviewWorker(): void {
  setInterval(() => {
    void reviewPendingMessages().catch((err) => {
      console.error("[tone-review-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[tone-review-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function reviewPendingMessages(): Promise<void> {
  const domain = createDomainService();

  const ids = await domain.listPendingToneReviewMessageIds(BATCH_LIMIT);
  if (ids.length === 0) return;

  console.log(`[tone-review-worker] ${ids.length} message(s) awaiting review`);

  for (const id of ids) {
    try {
      const message = await domain.getMessageById(id);
      if (!message) continue;

      const thread = await domain.getConversationThread(message.conversation_id);
      const recentMessages = (thread?.messages ?? [])
        .filter((m) => m.id !== id)
        .slice(-RECENT_MESSAGE_CONTEXT_LIMIT)
        .map((m) => ({ direction: m.direction, body: m.body }));

      const result = await reviewMessageTone({ body: message.body, recentMessages });
      await domain.applyToneReviewResult(id, result);
    } catch (err) {
      console.error(`[tone-review-worker] message ${id} failed:`, err);
      // Defaults to 'flagged' on any failure - the conservative outcome for
      // anything gating a send to a real resident. Without this, a thrown
      // error (a failed AI call, not just a malformed response) would leave
      // the row at 'pending' forever - invisible to the scheduled-message-
      // worker (never due) and to the admin override UI (which only shows
      // for 'flagged', not 'pending').
      await domain
        .applyToneReviewResult(id, {
          status: "flagged",
          reasoning: err instanceof Error ? `Review failed: ${err.message}` : "Review failed",
        })
        .catch((innerErr) => {
          console.error(`[tone-review-worker] failed to record failure for ${id}:`, innerErr);
        });
    }
  }
}
