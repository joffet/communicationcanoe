import { createAdminService, createDomainService } from "@communication-canoe/database";
import { dispatchOutboundMessage } from "@communication-canoe/messaging";
import { startPollLoop } from "./poll-loop.js";

const POLL_INTERVAL_MS = 5_000;
/** A queued message is already sitting behind a deliberate send delay, so a
 * few extra seconds before an idle loop notices it is not a deadline miss -
 * it is the same delay, slightly longer. */
const IDLE_POLL_INTERVAL_MS = 30_000;
const BATCH_LIMIT = 25;

/**
 * Drains Phase 3's internal-by-default/external-with-delay compose flow
 * (apps/web/src/app/api/internal/reside/conversations/[id]/messages/route.ts):
 * a reside admin's external reply is queued with scheduled_send_at in the
 * future so there's a real window to cancel before it goes out, rather than
 * the delay being just a UI countdown. Structured identically to
 * outbound-batch-worker.ts - same poll shape, same "single instance, no
 * distributed coordination" risk acceptance.
 */
export function startScheduledMessageWorker(): void {
  startPollLoop({
    name: "scheduled-message-worker",
    activeIntervalMs: POLL_INTERVAL_MS,
    idleIntervalMs: IDLE_POLL_INTERVAL_MS,
    tick: dispatchDueScheduledMessages,
  });
}

async function dispatchDueScheduledMessages(): Promise<boolean> {
  const domain = createDomainService();
  const admin = createAdminService();

  const ids = await domain.listDueScheduledMessageIds(BATCH_LIMIT);
  if (ids.length === 0) return false;

  console.log(`[scheduled-message-worker] ${ids.length} scheduled message(s) due`);

  for (const id of ids) {
    try {
      // Atomic queued -> sending transition: if a cancel request beat this
      // tick to the row, claimScheduledMessage returns null and we skip -
      // this is the entire race-safety mechanism for cancellation.
      const claimed = await domain.claimScheduledMessage(id);
      if (!claimed) continue;

      const thread = await domain.getConversationThread(claimed.conversationId);
      if (!thread) {
        await domain.updateMessageDeliveryStatus(id, {
          deliveryStatus: "failed",
          deliveryError: "conversation not found",
        });
        continue;
      }

      const tenant = await admin.getTenantById(claimed.tenantId);
      if (!tenant) {
        await domain.updateMessageDeliveryStatus(id, {
          deliveryStatus: "failed",
          deliveryError: "tenant not found",
        });
        continue;
      }

      const to = claimed.channel === "sms" ? thread.identity.phone : thread.identity.email;
      if (!to) {
        await domain.updateMessageDeliveryStatus(id, {
          deliveryStatus: "failed",
          deliveryError: `identity is missing ${claimed.channel === "sms" ? "phone" : "email"}`,
        });
        continue;
      }

      await dispatchOutboundMessage({ tenant, message: claimed, to });
    } catch (err) {
      console.error(`[scheduled-message-worker] message ${id} failed:`, err);
      await domain
        .updateMessageDeliveryStatus(id, {
          deliveryStatus: "failed",
          deliveryError: err instanceof Error ? err.message : String(err),
        })
        .catch((innerErr) => {
          console.error(`[scheduled-message-worker] failed to record failure for ${id}:`, innerErr);
        });
    }
  }

  return true;
}
