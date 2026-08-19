import { timingSafeEqual } from "node:crypto";
import { createAdminService, createDomainService } from "@communication-canoe/database";
import { notifyResideIdentityStatus } from "@/lib/reside/identity-status-client";

type SesEvent = {
  eventType: "Delivery" | "Bounce" | "Complaint" | string;
  mail: { messageId: string };
  delivery?: { timestamp?: string };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: { diagnosticCode?: string; emailAddress?: string }[];
  };
  complaint?: { complaintFeedbackType?: string };
};

type SnsEnvelope = {
  Type: "SubscriptionConfirmation" | "Notification" | "UnsubscribeConfirmation" | string;
  SubscribeURL?: string;
  Message?: string;
};

function verifyPathSecret(secret: string): boolean {
  const expected = process.env.SES_SNS_WEBHOOK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!verifyPathSecret(secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const envelope = JSON.parse(await request.text()) as SnsEnvelope;

  if (envelope.Type === "SubscriptionConfirmation") {
    if (envelope.SubscribeURL) {
      await fetch(envelope.SubscribeURL);
    }
    return new Response("OK", { status: 200 });
  }

  if (envelope.Type !== "Notification" || !envelope.Message) {
    return new Response("OK", { status: 200 });
  }

  const event = JSON.parse(envelope.Message) as SesEvent;
  const messageId = event.mail?.messageId;
  if (!messageId) {
    return new Response("OK", { status: 200 });
  }

  const domain = createDomainService();
  const message = await domain.getMessageByProviderMessageId(messageId);
  if (!message) {
    return new Response("OK", { status: 200 });
  }

  if (event.eventType === "Delivery") {
    await domain.updateMessageDeliveryStatus(message.id, {
      deliveryStatus: "delivered",
      deliveredAt: event.delivery?.timestamp ?? new Date().toISOString(),
    });
    await recordOutcomeAndMaybeNotifyReside(domain, message, "success");
  } else if (event.eventType === "Bounce") {
    const detail =
      event.bounce?.bouncedRecipients?.[0]?.diagnosticCode ??
      [event.bounce?.bounceType, event.bounce?.bounceSubType].filter(Boolean).join("/") ??
      "bounced";
    await domain.updateMessageDeliveryStatus(message.id, {
      deliveryStatus: "failed",
      deliveryError: detail,
    });
    // Only hard (Permanent) bounces count toward the threshold - transient
    // bounces are likely to succeed on a later retry.
    if (event.bounce?.bounceType === "Permanent") {
      await recordOutcomeAndMaybeNotifyReside(domain, message, "hard_failure");
    }
  } else if (event.eventType === "Complaint") {
    await domain.updateMessageDeliveryStatus(message.id, {
      deliveryStatus: "failed",
      deliveryError: event.complaint?.complaintFeedbackType ?? "complaint",
    });
    // A spam complaint is at least as strong a signal to stop emailing this
    // address as a hard bounce.
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
  const threshold = settings?.bounce_threshold ?? 3;

  const { crossedThreshold, clearedFlag } = await domain.recordChannelDeliveryOutcome(
    thread.identity.id,
    "email",
    outcome,
    threshold,
  );

  if ((crossedThreshold || clearedFlag) && thread.identity.resideResidentId) {
    // message.tenantId is comm-canoe's internal uuid; reside only recognises
    // its own client uid, so translate before calling out.
    const tenant = await createAdminService().getTenantById(message.tenantId);
    if (!tenant) return;

    await notifyResideIdentityStatus({
      resideClientUid: tenant.reside_client_uid,
      resideResidentId: thread.identity.resideResidentId,
      channel: "email",
      status: crossedThreshold ? "undeliverable" : "deliverable",
    });
  }
}
