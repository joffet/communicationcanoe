import { createDomainService } from "@contact/database";
import { parsePostmarkInbound } from "@contact/shared/email";
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
  const conversation = await domain.findOrCreateConversation(tenant.id, identity.id);

  const body = email.textBody || email.subject;
  await domain.appendMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    channel: "email",
    direction: "inbound",
    senderType: "external",
    body,
    subject: email.subject,
  });

  void triggerConversationRouting(conversation.id, tenant.id).catch(console.error);

  return Response.json({ ok: true });
}
