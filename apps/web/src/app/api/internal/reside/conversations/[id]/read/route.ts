import { createDomainService } from "@communication-canoe/database";
import { resideMarkReadInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideMarkReadInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId, actor } = parsed.data;

  const guard = await resolveTenantScopedConversation(tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  const { userId } = await resolveOrCreateResideActor({ ...actor, resideClientUid: tenantId });

  // Write against the resolved canonical id (Phase 7 merge redirect) - the
  // read cursor is advanced to the latest message across the whole merge
  // chain, not just this conversation row.
  const domain = createDomainService();
  const readState = await domain.markConversationRead(guard.conversation.id, userId);

  return Response.json({ readState });
}
