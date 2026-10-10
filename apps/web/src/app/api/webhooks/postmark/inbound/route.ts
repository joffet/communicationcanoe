import { timingSafeEqual } from "node:crypto";
import { createDomainService } from "@communication-canoe/database";
import { parsePostmarkInbound } from "@communication-canoe/shared/email";
import { triggerConversationRouting } from "@/lib/ai/routing";

function secretMatches(secret: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Postmark's inbound webhook authenticates with HTTP basic auth written into
 * the webhook URL (https://postmark:<secret>@host/api/webhooks/postmark/inbound);
 * the password is the secret, the username is ignored. The
 * x-postmark-webhook-secret header is still accepted for anything already
 * configured that way. Fails closed: an unset secret means no access - an open
 * endpoint would let anyone post mail into any tenant's inbox.
 */
function verifyPostmarkWebhook(request: Request): boolean {
  const secret = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET;
  if (!secret) return false;

  if (secretMatches(secret, request.headers.get("x-postmark-webhook-secret"))) return true;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  return decoded.includes(":") && secretMatches(secret, password);
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
  // First recipient that is a tenant's inbound address wins - a resident who
  // writes to their building with someone else first in To, or with the
  // building in Cc, still reaches it.
  let tenant = null;
  for (const address of email.recipients ?? [email.to]) {
    tenant = await domain.resolveTenantByEmail(address);
    if (tenant) break;
  }
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
