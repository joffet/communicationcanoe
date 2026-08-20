import { createDomainService } from "@communication-canoe/database";
import { resideConversationReplyInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

const DEFAULT_EXTERNAL_SEND_DELAY_SECONDS = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideConversationReplyInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // reside sends its OWN client uid here, which may be a slug (e.g. "cardiff").
  // Every domain call below keys on the `tenant_id` uuid column, so they take
  // the guard's resolved `tenant.id` instead - never this value.
  const { tenantId: resideClientUid, actor, channel, body, visibility } = parsed.data;

  const guard = await resolveTenantScopedConversation(resideClientUid, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  const commCanoeTenantId = guard.tenant.id;
  const domain = createDomainService();
  const { userId: actorUserId } = await resolveOrCreateResideActor({ ...actor, resideClientUid });

  if (visibility === "internal") {
    // Write against the resolved canonical id (Phase 7 merge redirect).
    const message = await domain.appendMessage({
      tenantId: commCanoeTenantId,
      conversationId: guard.conversation.id,
      channel,
      direction: "outbound",
      senderType: "internal_user",
      senderId: actorUserId,
      body,
      visibility: "internal",
    });
    return Response.json({ message });
  }

  // External: not dispatched inline. Queued with a scheduled_send_at in the
  // future so the admin has a real window to cancel - the realtime-bridge
  // scheduled-message-worker (Phase 3C) claims and actually sends it once
  // due, gated on ai_review_status = 'approved' (Phase 6) - the
  // tone-review-worker picks up 'pending' messages and transitions them
  // before the delay elapses.
  const settings = await domain.getTenantSettings(commCanoeTenantId);
  const delaySeconds = settings?.externalSendDelaySeconds ?? DEFAULT_EXTERNAL_SEND_DELAY_SECONDS;
  const scheduledSendAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

  // Write against the resolved canonical id (Phase 7 merge redirect).
  const message = await domain.appendMessage({
    tenantId: commCanoeTenantId,
    conversationId: guard.conversation.id,
    channel,
    direction: "outbound",
    senderType: "internal_user",
    senderId: actorUserId,
    body,
    visibility: "external",
    deliveryStatus: "queued",
    scheduledSendAt,
    aiReviewStatus: "pending",
  });

  return Response.json({ message, scheduledSendAt });
}
