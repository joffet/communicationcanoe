import { createDomainService } from "@communication-canoe/database";
import { resideRemoveAssigneeInputSchema } from "@communication-canoe/shared/schemas";
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
  const parsed = resideRemoveAssigneeInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const guard = await resolveTenantScopedConversation(parsed.data.tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // Removal only looks up, never creates - an assignee being removed
  // necessarily already resolved on the way in.
  const targetUserId = await findResideActorUserId(resideUserId);
  if (targetUserId) {
    // Write against the resolved canonical id (Phase 7 merge redirect).
    const domain = createDomainService();
    await domain.removeConversationAssignee(guard.conversation.id, targetUserId);

    // Only clear the single-column assigned_user_id if it currently matches
    // the removed user - don't clobber a different still-assigned admin
    // when a conversation has multiple assignees.
    if (guard.conversation.assigned_user_id === targetUserId) {
      await domain.assignConversationUser(guard.conversation.id, null);
    }
  }

  return new Response(null, { status: 204 });
}
