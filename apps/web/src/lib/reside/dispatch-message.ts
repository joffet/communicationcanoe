import { createDomainService } from "@communication-canoe/database";
import type { Message, Tenant } from "@communication-canoe/database";
import { sendSms } from "@/lib/sms";
import { sendTenantReplyEmail } from "@/lib/email/tenant-reply";

/**
 * Sends an already-created outbound message row via its channel's provider and records the
 * resulting delivery status. Shared by the reside send endpoint and the retry seam so both
 * paths update `messages` the same way.
 */
export async function dispatchOutboundMessage(params: {
  tenant: Tenant;
  message: Message;
  to: string;
}): Promise<Message> {
  const domain = createDomainService();
  const { tenant, message, to } = params;

  try {
    if (message.channel === "sms") {
      const result = await sendSms({ to, from: tenant.twilio_number, body: message.body });
      return await domain.updateMessageDeliveryStatus(message.id, {
        deliveryStatus: "sent",
        providerMessageId: result.sid,
        sentAt: new Date().toISOString(),
        incrementAttempts: true,
      });
    }

    if (message.channel === "email") {
      const result = await sendTenantReplyEmail({
        to,
        subject: message.subject ?? "",
        text: message.body,
        tenant,
      });
      return await domain.updateMessageDeliveryStatus(message.id, {
        deliveryStatus: "sent",
        providerMessageId: result.messageId,
        sentAt: new Date().toISOString(),
        incrementAttempts: true,
      });
    }

    throw new Error(`Unsupported channel for outbound dispatch: ${message.channel}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return domain.updateMessageDeliveryStatus(message.id, {
      deliveryStatus: "failed",
      deliveryError: errorMessage,
      incrementAttempts: true,
    });
  }
}
