import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideSendMessageInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { dispatchOutboundMessage } from "@communication-canoe/messaging";

export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideSendMessageInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // reside sends its own client uid in this field - resolved to comm-canoe's
  // internal tenant id below, which is what every tenant_id column stores.
  const {
    tenantId: resideClientUid,
    channel,
    identity,
    body,
    subject,
    conversationId,
    idempotencyKey,
  } = parsed.data;

  const to = channel === "sms" ? identity.phone : identity.email;
  if (!to) {
    return Response.json(
      { error: `identity.${channel === "sms" ? "phone" : "email"} is required for channel "${channel}"` },
      { status: 400 },
    );
  }

  const admin = createAdminService();
  const domain = createDomainService();

  const tenant = await admin.getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  // Idempotency short-circuit, before any identity/conversation side effects.
  // reside's retry queue re-sends with the same key after a lost response; if
  // that first attempt actually landed, return the existing message rather
  // than delivering to the resident a second time.
  if (idempotencyKey) {
    const existing = await domain.getMessageByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      return Response.json({
        message: {
          id: existing.id,
          conversationId: existing.conversationId,
          deliveryStatus: existing.deliveryStatus,
          providerMessageId: existing.providerMessageId,
          deliveryError: existing.deliveryError,
          deduplicated: true,
        },
      });
    }
  }

  const resolvedIdentity = await domain.findOrCreateIdentity(tenantId, identity);

  let conversation;
  if (conversationId) {
    const thread = await domain.getConversationThread(conversationId);
    if (!thread || thread.tenant_id !== tenantId || thread.identity_id !== resolvedIdentity.id) {
      return Response.json({ error: "conversationId does not belong to this tenant/identity" }, { status: 400 });
    }
    conversation = thread;
  } else {
    // Outbound/system-attributed send - no topic to classify, isStale is
    // irrelevant here (Phase 9's staleness check only matters for inbound
    // resident messages).
    ({ conversation } = await domain.findOrCreateConversation(tenantId, resolvedIdentity.id, { channel }));
  }

  const message = await domain.appendMessage({
    tenantId,
    idempotencyKey,
    conversationId: conversation.id,
    channel,
    direction: "outbound",
    senderType: "system",
    body,
    subject,
    deliveryStatus: "queued",
    // Reside-originated sends are always actually delivered to the resident.
    visibility: "external",
  });

  const sent = await dispatchOutboundMessage({ tenant, message, to });

  return Response.json({
    message: {
      id: sent.id,
      conversationId: sent.conversationId,
      deliveryStatus: sent.deliveryStatus,
      providerMessageId: sent.providerMessageId,
      deliveryError: sent.deliveryError,
    },
  });
}
