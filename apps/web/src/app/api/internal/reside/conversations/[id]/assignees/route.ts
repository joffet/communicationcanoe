import { createDomainService } from "@communication-canoe/database";
import { resideAssigneeInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideAssigneeInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId, actor, assignee } = parsed.data;

  const guard = await resolveTenantScopedConversation(tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // conversation_assignees.user_id is a required FK - both the target being
  // assigned and (when available) the actor performing the action resolve
  // to real comm-canoe users. Self-assign sends the same admin as both.
  const [{ userId: actorUserId }, { userId: assigneeUserId }] = await Promise.all([
    resolveOrCreateResideActor({ ...actor, resideClientUid: tenantId }),
    resolveOrCreateResideActor({ ...assignee, resideClientUid: tenantId }),
  ]);

  // Write against the resolved canonical id (Phase 7 merge redirect).
  const domain = createDomainService();
  const result = await domain.addConversationAssignee(guard.conversation.id, assigneeUserId, actorUserId);

  // Also mirror onto the single-column assigned_user_id (last-assigned-wins)
  // - comm-canoe's own dashboard (inbox-shell.tsx) gates its reply-box/join-
  // chat UI on this column alone and never reads conversation_assignees, so
  // a reside-driven assignment would otherwise be invisible there.
  await domain.assignConversationUser(guard.conversation.id, assigneeUserId);

  return Response.json({ assignee: result });
}
