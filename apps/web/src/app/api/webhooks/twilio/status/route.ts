import twilio from "twilio";
import { createAdminService, createDomainService } from "@communication-canoe/database";
import type { MessageDeliveryStatus } from "@communication-canoe/database";
import { notifyResideIdentityStatus } from "@/lib/reside/identity-status-client";

function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}

function parseFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function mapTwilioStatus(status: string): MessageDeliveryStatus | null {
  switch (status) {
    case "queued":
    case "sending":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new Response("Twilio not configured", { status: 503 });
  }

  const rawBody = await request.text();
  const params = parseFormBody(rawBody);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/status`
    : request.url;

  if (!validateTwilioSignature(authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const messageSid = params.MessageSid;
  const deliveryStatus = mapTwilioStatus(params.MessageStatus ?? "");
  if (!messageSid || !deliveryStatus) {
    return new Response("OK", { status: 200 });
  }

  const domain = createDomainService();
  const message = await domain.getMessageByProviderMessageId(messageSid);
  if (!message) {
    return new Response("OK", { status: 200 });
  }

  await domain.updateMessageDeliveryStatus(message.id, {
    deliveryStatus,
    deliveryError:
      deliveryStatus === "failed" || deliveryStatus === "undelivered"
        ? (params.ErrorMessage ?? params.ErrorCode ?? null)
        : null,
    deliveredAt: deliveryStatus === "delivered" ? new Date().toISOString() : undefined,
  });

  if (deliveryStatus === "delivered") {
    await recordOutcomeAndMaybeNotifyReside(domain, message, "success");
  } else if (deliveryStatus === "failed" || deliveryStatus === "undelivered") {
    await recordOutcomeAndMaybeNotifyReside(domain, message, "hard_failure");
  }

  return new Response("OK", { status: 200 });
}

async function recordOutcomeAndMaybeNotifyReside(
  domain: ReturnType<typeof createDomainService>,
  message: { id: string; tenantId: string; conversationId: string },
  outcome: "success" | "hard_failure",
): Promise<void> {
  const thread = await domain.getConversationThread(message.conversationId);
  if (!thread) return;

  const settings = await domain.getTenantSettings(message.tenantId);
  const threshold = settings?.bounceThreshold ?? 3;

  const { crossedThreshold, clearedFlag } = await domain.recordChannelDeliveryOutcome(
    thread.identity.id,
    "sms",
    outcome,
    threshold,
  );

  if ((crossedThreshold || clearedFlag) && thread.identity.resideResidentId) {
    // message.tenantId is comm-canoe's internal uuid; reside only recognises
    // its own client uid, so translate before calling out (mirrors the SES
    // bounce path in webhooks/ses/notifications).
    const tenant = await createAdminService().getTenantById(message.tenantId);
    if (!tenant) return;

    await notifyResideIdentityStatus({
      resideClientUid: tenant.resideClientUid,
      resideResidentId: thread.identity.resideResidentId,
      channel: "sms",
      status: crossedThreshold ? "undeliverable" : "deliverable",
    });
  }
}
