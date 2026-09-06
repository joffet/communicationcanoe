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
    from,
    attachments,
    deliverTo,
    newConversation,
  } = parsed.data;

  // An inbox message is not going anywhere, so it needs no destination. Every
  // other send still does, and a missing one is still a 400 rather than a
  // message that quietly lands nowhere.
  const inboxOnly = deliverTo === "inbox";
  const to = channel === "sms" ? identity.phone : identity.email;
  if (!inboxOnly && !to) {
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
    if (!thread || thread.tenantId !== tenantId || thread.identityId !== resolvedIdentity.id) {
      return Response.json({ error: "conversationId does not belong to this tenant/identity" }, { status: 400 });
    }
    conversation = thread;
  } else {
    // Outbound/system-attributed send - no topic to classify, isStale is
    // irrelevant here (Phase 9's staleness check only matters for inbound
    // resident messages).
    ({ conversation } = await domain.findOrCreateConversation(tenantId, resolvedIdentity.id, {
      channel,
      // "Send this to my inbox" means its own thread, not an addition to
      // whatever conversation happens to be open with this person.
      forceNew: newConversation === true,
    }));
  }

  const message = await domain.appendMessage({
    tenantId,
    idempotencyKey,
    conversationId: conversation.id,
    // web_chat is the existing name for a message that lives in the app rather
    // than on a carrier. Recording an inbox message as "email" would make the
    // thread claim an email was sent, and the delivery columns would be the
    // only thing saying otherwise.
    channel: inboxOnly ? "web_chat" : channel,
    direction: "outbound",
    senderType: "system",
    body,
    subject,
    // Nothing is queued for an inbox message - it is already where it was
    // going, and "queued" would leave it looking permanently pending.
    deliveryStatus: inboxOnly ? "delivered" : "queued",
    // External even when nothing is delivered: "external" is what the member
    // inbox reads, and "internal" would hide the message from the person it
    // was written for.
    visibility: "external",
  });

  if (inboxOnly) {
    return Response.json({
      message: {
        id: message.id,
        conversationId: message.conversationId,
        deliveryStatus: message.deliveryStatus,
        providerMessageId: null,
        deliveryError: null,
      },
    });
  }

  if (!to) {
    // Not reachable: a channel send without a destination was refused above,
    // and an inbox send has already returned. Written as a guard rather than a
    // non-null assertion so that if either of those changes, this fails
    // loudly here instead of handing undefined to a carrier.
    return Response.json({ error: "no destination for a channel send" }, { status: 400 });
  }

  const sent = await dispatchOutboundMessage({ tenant, message, to, from, attachments });

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
