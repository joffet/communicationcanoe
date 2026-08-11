import { createDomainService } from "@communication-canoe/database";
import { parsePostmarkInbound } from "@communication-canoe/shared/email";
import { triggerConversationRouting } from "@/lib/ai/routing";

function verifyPostmarkWebhook(request: Request): boolean {
  const secret = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET;
  if (!secret) return true;
  const header = request.headers.get("x-postmark-webhook-secret");
  return header === secret;
}

export async function POST(request: Request) {
  if (!verifyPostmarkWebhook(request)) {
    return new Response("Invalid webhook secret", { status: 403 });
  }

  const payload = await request.json();
  const email = parsePostmarkInbound(payload);

  if (!email.from || !email.to) {
    return new Response("Missing from/to", { status: 400 });
  }

  const domain = createDomainService();
  const tenant = await domain.resolveTenantByEmail(email.to);
  if (!tenant) {
    return new Response("Unknown tenant email", { status: 404 });
  }

  const identity = await domain.findOrCreateIdentity(tenant.id, {
    email: email.from,
    name: email.fromName,
  });
  const { conversation, isStale } = await domain.findOrCreateConversation(tenant.id, identity.id, {
    channel: "email",
    subject: email.subject,
  });

  const body = email.textBody || email.subject;
  await domain.appendMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    channel: "email",
    direction: "inbound",
    senderType: "external",
    body,
    subject: email.subject,
    // Came directly from the customer.
    visibility: "external",
    // Phase 9: flags this message for the async AI topic-shift check when
    // the conversation it landed in had gone quiet past the tenant's
    // staleness threshold - never blocks this response on an AI call.
    ...(isStale && { topicCheckStatus: "pending" }),
  });

  void triggerConversationRouting(conversation.id, tenant.id).catch(console.error);

  return Response.json({ ok: true });
}
