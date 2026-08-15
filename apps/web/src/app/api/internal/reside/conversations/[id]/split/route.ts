import { createDomainService } from "@communication-canoe/database";
import { resideSplitConversationInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideSplitConversationInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // reside's own client uid, which may be a slug - splitConversation keys on
  // the `tenant_id` uuid column, so it takes the guard's resolved id instead.
  const { tenantId: resideClientUid, actor, messageId } = parsed.data;

  const guard = await resolveTenantScopedConversation(resideClientUid, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  const { userId: actorUserId } = await resolveOrCreateResideActor({ ...actor, resideClientUid });

  try {
    // Write against the resolved canonical id (Phase 7 merge redirect) -
    // splitConversation also independently re-resolves and aborts on a
    // concurrent merge, but starting from the guard's already-resolved id
    // avoids a pointless split-then-abort in the common case.
    const newConversationId = await createDomainService().splitConversation(
      guard.tenant.id,
      guard.conversation.id,
      messageId,
      actorUserId,
    );
    return Response.json({ newConversationId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to split conversation";
    return Response.json({ error: message }, { status: 400 });
  }
}
