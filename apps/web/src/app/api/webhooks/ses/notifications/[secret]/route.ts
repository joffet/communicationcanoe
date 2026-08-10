import { timingSafeEqual } from "node:crypto";
import { createDomainService } from "@communication-canoe/database";

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
  } else if (event.eventType === "Bounce") {
    const detail =
      event.bounce?.bouncedRecipients?.[0]?.diagnosticCode ??
      [event.bounce?.bounceType, event.bounce?.bounceSubType].filter(Boolean).join("/") ??
      "bounced";
    await domain.updateMessageDeliveryStatus(message.id, {
      deliveryStatus: "failed",
      deliveryError: detail,
    });
  } else if (event.eventType === "Complaint") {
    await domain.updateMessageDeliveryStatus(message.id, {
      deliveryStatus: "failed",
      deliveryError: event.complaint?.complaintFeedbackType ?? "complaint",
    });
  }

  return new Response("OK", { status: 200 });
}
