import { createDomainService } from "@communication-canoe/database";
import { resideRemovePersonalTagInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { findResideActorUserId } from "@/lib/reside/resolve-actor";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; resideUserId: string }> },
) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id, resideUserId } = await params;
  const parsed = resideRemovePersonalTagInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const guard = await resolveTenantScopedConversation(parsed.data.tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // Removal only looks up, never creates - a personal tag being removed
  // necessarily already resolved on the way in.
  const targetUserId = await findResideActorUserId(resideUserId);
  if (targetUserId) {
    // Write against the resolved canonical id (Phase 7 merge redirect).
    const domain = createDomainService();
    await domain.removeConversationPersonalTag(guard.conversation.id, targetUserId);
  }

  return new Response(null, { status: 204 });
}
