import { createAdminService, createDomainService } from "@communication-canoe/database";
import { dispatchOutboundMessage } from "@communication-canoe/messaging";

/**
 * Clean seam for re-sending a message that previously failed (e.g. surfaced via a `failed`
 * delivery-status webhook with a transient error). Not wired to a scheduler/cron yet — no
 * job-queue infra exists and it's out of proportion for zero production traffic. Intended to
 * be called from a future Railway cron task or a manual admin action.
 */
export async function retryFailedMessage(messageId: string) {
  const domain = createDomainService();
  const admin = createAdminService();

  const message = await domain.getMessageById(messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  if (message.channel !== "sms" && message.channel !== "email") {
    throw new Error(`Message channel "${message.channel}" is not retryable`);
  }

  const [tenant, thread] = await Promise.all([
    admin.getTenantById(message.tenant_id),
    domain.getConversationThread(message.conversation_id),
  ]);
  if (!tenant) throw new Error(`Tenant not found: ${message.tenant_id}`);
  if (!thread) throw new Error(`Conversation not found: ${message.conversation_id}`);

  const to = message.channel === "sms" ? thread.identity.phone : thread.identity.email;
  if (!to) {
    throw new Error(
      `Identity is missing ${message.channel === "sms" ? "phone" : "email"} required to retry`,
    );
  }

  return dispatchOutboundMessage({ tenant, message, to });
}
