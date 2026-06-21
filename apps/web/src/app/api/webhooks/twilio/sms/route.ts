import twilio from "twilio";
import { createDomainService } from "@communication-canoe/database";
import { triggerConversationRouting } from "@/lib/ai/routing";

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

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new Response("Twilio not configured", { status: 503 });
  }

  const rawBody = await request.text();
  const params = parseFormBody(rawBody);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sms`
    : request.url;

  if (!validateTwilioSignature(authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From;
  const to = params.To;
  const body = params.Body ?? "";

  if (!from || !to) {
    return new Response("Missing From/To", { status: 400 });
  }

  const domain = createDomainService();
  const tenant = await domain.resolveTenantByPhone(to);
  if (!tenant) {
    return new Response("Unknown tenant number", { status: 404 });
  }

  const identity = await domain.findOrCreateIdentity(tenant.id, { phone: from });
  const conversation = await domain.findOrCreateConversation(tenant.id, identity.id);

  await domain.appendMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    channel: "sms",
    direction: "inbound",
    senderType: "external",
    body,
  });

  void triggerConversationRouting(conversation.id, tenant.id).catch(console.error);

  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
