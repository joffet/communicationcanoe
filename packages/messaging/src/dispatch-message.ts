import { createDomainService } from "@communication-canoe/database";
import type { Message, Tenant } from "@communication-canoe/database";
import { sendSms } from "./sms/send";
import { sendTenantReplyEmail } from "./email/tenant-reply";
import { createEmailOpenToken } from "./email/open-tracking-token";

function withOpenTrackingPixel(html: string, messageId: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return html; // tracking is best-effort; never block a send over it

  const token = createEmailOpenToken(messageId);
  const pixel = `<img src="${appUrl}/api/track/email-open?t=${token}" width="1" height="1" alt="" style="display:none" />`;
  return `${html}${pixel}`;
}

/** Phase 4: gives a resident a way to click through to their reside Inbox
 * from an admin's reply email - injected at send time only (never written
 * into the stored messages.body), same as the open-tracking pixel above.
 * Only for admin conversation replies (sender_type 'internal_user') - every
 * other outbound path (Notices, system sends) uses 'system' and is
 * untouched. Best-effort: a missing RESIDE_APP_URL just omits the link. */
function withMemberPortalLink(
  html: string,
  conversationId: string,
  tenant?: { resideAppUrl?: string | null } | null,
): string {
  // Prefer this client's own reside host (derived from its routingDomain) so a
  // One Cardiff resident is sent to One Cardiff's portal, not a shared one. The
  // env var remains the fallback for tenants provisioned before reside_app_url
  // existed, or clients with no routing domain configured.
  const resideAppUrl = tenant?.resideAppUrl || process.env.RESIDE_APP_URL;
  if (!resideAppUrl) return html;

  const base = resideAppUrl.replace(/\/+$/, "");
  const link = `<p><a href="${base}/member/inbox/${conversationId}">View and reply</a></p>`;
  return `${html}${link}`;
}

/**
 * Sends an already-created outbound message row via its channel's provider and records the
 * resulting delivery status. Shared by the reside single-send endpoint, the bulk-send worker
 * (apps/realtime-bridge), and the retry seam so every path updates `messages` the same way.
 */
export async function dispatchOutboundMessage(params: {
  tenant: Tenant;
  message: Message;
  to: string;
  /** Per-send From override for email - reside's building sending identity.
   * Not persisted on the message row: reside re-derives it on every retry so
   * a replay carries the building's current address, not the one configured
   * when the first attempt failed. */
  from?: string;
}): Promise<Message> {
  const domain = createDomainService();
  const { tenant, message, to, from } = params;

  try {
    if (message.channel === "sms") {
      const result = await sendSms({ to, from: tenant.twilioNumber, body: message.body });
      return await domain.updateMessageDeliveryStatus(message.id, {
        deliveryStatus: "sent",
        providerMessageId: result.sid,
        sentAt: new Date().toISOString(),
        incrementAttempts: true,
      });
    }

    if (message.channel === "email") {
      let html = withOpenTrackingPixel(message.body, message.id);
      if (message.senderType === "internal_user") {
        html = withMemberPortalLink(html, message.conversationId, tenant);
      }
      const result = await sendTenantReplyEmail({
        to,
        subject: message.subject ?? "",
        text: html,
        tenant,
        from,
        // Reside always sends its rendered HTML (notification templates,
        // notice bodies) as `body` - never plain text needing escaping.
        isHtml: true,
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
