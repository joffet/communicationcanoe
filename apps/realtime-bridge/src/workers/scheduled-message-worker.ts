import { createAdminService, createDomainService } from "@communication-canoe/database";
import { dispatchOutboundMessage } from "@communication-canoe/messaging";

const POLL_INTERVAL_MS = 5_000;
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
  setInterval(() => {
    void dispatchDueScheduledMessages().catch((err) => {
      console.error("[scheduled-message-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[scheduled-message-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function dispatchDueScheduledMessages(): Promise<void> {
  const domain = createDomainService();
  const admin = createAdminService();

  const ids = await domain.listDueScheduledMessageIds(BATCH_LIMIT);
  if (ids.length === 0) return;

  console.log(`[scheduled-message-worker] ${ids.length} scheduled message(s) due`);

  for (const id of ids) {
    try {
      // Atomic queued -> sending transition: if a cancel request beat this
      // tick to the row, claimScheduledMessage returns null and we skip -
      // this is the entire race-safety mechanism for cancellation.
      const claimed = await domain.claimScheduledMessage(id);
      if (!claimed) continue;

      const thread = await domain.getConversationThread(claimed.conversation_id);
      if (!thread) {
        await domain.updateMessageDeliveryStatus(id, {
          deliveryStatus: "failed",
          deliveryError: "conversation not found",
        });
        continue;
      }

      const tenant = await admin.getTenantById(claimed.tenant_id);
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
}
