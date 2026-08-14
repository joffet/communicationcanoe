import { createDomainService } from "@communication-canoe/database";
import { residePersonalTagInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = residePersonalTagInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId, actor, target } = parsed.data;

  const guard = await resolveTenantScopedConversation(tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // conversation_personal_tags.user_id is a required FK - both the actor and
  // the admin being personally-tagged resolve to real comm-canoe users.
  // Self-tagging sends the same admin as both.
  const [, { userId: targetUserId }] = await Promise.all([
    resolveOrCreateResideActor({ ...actor, resideClientUid: tenantId }),
    resolveOrCreateResideActor({ ...target, resideClientUid: tenantId }),
  ]);

  // Write against the resolved canonical id (Phase 7 merge redirect).
  const domain = createDomainService();
  const personalTag = await domain.addConversationPersonalTag(guard.conversation.id, targetUserId);

  return Response.json({ personalTag });
}
