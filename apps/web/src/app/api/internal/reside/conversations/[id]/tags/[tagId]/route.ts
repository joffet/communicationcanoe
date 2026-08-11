import { createDomainService } from "@communication-canoe/database";
import { resideRemoveTagInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id, tagId } = await params;
  const parsed = resideRemoveTagInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const guard = await resolveTenantScopedConversation(parsed.data.tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  const domain = createDomainService();
  // Write against the resolved canonical id (Phase 7 merge redirect).
  await domain.removeConversationTag(guard.conversation.id, tagId);

  return new Response(null, { status: 204 });
}
