import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideMemberReplyInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { verifyConversationOwnership } from "@/lib/reside/member-conversation-guard";
import { notifyResideActivity } from "@/lib/reside/notify-activity";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideMemberReplyInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId: resideClientUid, contact, channel, body } = parsed.data;

  const admin = createAdminService();
  const tenant = await admin.getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  const domain = createDomainService();
  // The one legitimate creation path in Phase 4 - a genuinely first-time
  // contact replying needs an identity to exist before appendMessage can
  // reference it as sender_id.
  const identity = await domain.findOrCreateIdentity(tenantId, contact);

  const conversation = await domain.getConversationThread(id);
  if (!conversation || conversation.tenant_id !== tenantId) {
    return new Response("Unknown conversation", { status: 404 });
  }
  const owned = await verifyConversationOwnership(conversation, identity.id);
  if (!owned) {
    return new Response("Unknown conversation", { status: 404 });
  }

  // Best-effort spam guard, not a real distributed rate limiter (no counter
  // infra exists in this codebase) - counts the resident's own recent
  // external inbound messages in the thread already fetched above.
  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
  const recentReplyCount = conversation.messages.filter(
    (m) =>
      m.visibility === "external" &&
      m.direction === "inbound" &&
      new Date(m.createdAt).getTime() >= windowStart,
  ).length;
  if (recentReplyCount >= RATE_LIMIT_MAX) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const message = await domain.appendMessage({
    tenantId,
    conversationId: id,
    channel,
    direction: "inbound",
    senderType: "external",
    senderId: identity.id,
    visibility: "external",
    body,
  });

  void notifyResideActivity({
    // reside's own identifier, NOT tenantId - reside matches this against its
    // own client records and would never recognise comm-canoe's internal uuid.
    resideClientUid: tenant.reside_client_uid,
    conversationId: id,
    summary: `New message from ${identity.name ?? identity.email ?? identity.phone ?? "a resident"}`,
  });

  return Response.json({
    message: {
      id: message.id,
      channel: message.channel,
      direction: message.direction,
      sender_type: message.senderType,
      body: message.body,
      created_at: message.createdAt,
    },
  });
}
