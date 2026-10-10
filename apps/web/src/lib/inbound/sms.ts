import type { createDomainService } from "@communication-canoe/database";
import type { TenantId } from "@communication-canoe/shared/brands";
import { triggerConversationRouting } from "@/lib/ai/routing";

type DomainService = ReturnType<typeof createDomainService>;

/**
 * Lands one inbound resident text in the inbox: identity, conversation,
 * message, then routing. Shared by the two ways a text can arrive - Twilio
 * calling /api/webhooks/twilio/sms directly, and reside forwarding one it
 * received on its own /api/sms/inbound (where tenants' numbers point today,
 * because reside owns STOP/START opt-outs) - so the two cannot drift apart.
 *
 * `idempotencyKey` makes a retried delivery of the same message a no-op; the
 * Twilio webhook has none to give and leaves it unset, as it always has.
 */
export async function ingestInboundSms(
  domain: DomainService,
  input: { tenantId: TenantId; from: string; body: string; idempotencyKey?: string },
): Promise<{ conversationId: string; messageId: string; deduplicated: boolean }> {
  const { tenantId, from, body, idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = await domain.getMessageByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      return { conversationId: existing.conversationId, messageId: existing.id, deduplicated: true };
    }
  }

  const identity = await domain.findOrCreateIdentity(tenantId, { phone: from });
  const { conversation, isStale } = await domain.findOrCreateConversation(tenantId, identity.id, {
    channel: "sms",
  });

  let message;
  try {
    message = await domain.appendMessage({
      tenantId,
      conversationId: conversation.id,
      channel: "sms",
      direction: "inbound",
      senderType: "external",
      body,
      // Came directly from the customer.
      visibility: "external",
      idempotencyKey,
      // Phase 9: flags this message for the async AI topic-shift check when
      // the conversation it landed in had gone quiet past the tenant's
      // staleness threshold - never blocks this response on an AI call.
      ...(isStale && { topicCheckStatus: "pending" }),
    });
  } catch (error) {
    // reside retries a forward that timed out, so the retry can race the
    // first attempt past the check above; the unique index turns the loser's
    // insert into an error. If the winner's row is there, this was a duplicate.
    const existing = idempotencyKey
      ? await domain.getMessageByIdempotencyKey(tenantId, idempotencyKey)
      : null;
    if (!existing) throw error;
    return { conversationId: existing.conversationId, messageId: existing.id, deduplicated: true };
  }

  void triggerConversationRouting(conversation.id, tenantId).catch(console.error);

  return { conversationId: conversation.id, messageId: message.id, deduplicated: false };
}
