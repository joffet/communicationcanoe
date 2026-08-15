import { createDomainService } from "@communication-canoe/database";
import { resideMergeConversationsInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideMergeConversationsInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // reside's own client uid, which may be a slug - mergeConversations keys on
  // the `tenant_id` uuid column, so it takes the guard's resolved id instead.
  const { tenantId: resideClientUid, actor, targetConversationId } = parsed.data;

  const [sourceGuard, targetGuard] = await Promise.all([
    resolveTenantScopedConversation(resideClientUid, id),
    resolveTenantScopedConversation(resideClientUid, targetConversationId),
  ]);
  if (!sourceGuard.ok) return new Response("Unknown conversation", { status: sourceGuard.status });
  if (!targetGuard.ok) return new Response("Unknown target conversation", { status: targetGuard.status });

  // Resolved for consistency with every other actor-attributed write in this
  // API - nothing currently stores a per-merge audit log (no requirement
  // surfaced for one), so the resolved id isn't threaded further yet.
  await resolveOrCreateResideActor({ ...actor, resideClientUid });

  try {
    const mergedConversationId = await createDomainService().mergeConversations(
      sourceGuard.tenant.id,
      id,
      targetConversationId,
    );
    return Response.json({ mergedConversationId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to merge conversations";
    return Response.json({ error: message }, { status: 400 });
  }
}
