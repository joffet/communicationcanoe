import { createDomainService } from "@communication-canoe/database";
import { resideParticipantInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { resolveOrCreateResideActor } from "@/lib/reside/resolve-actor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideParticipantInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId, actor, participant } = parsed.data;

  const guard = await resolveTenantScopedConversation(tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // actor isn't recorded anywhere for participants (no actor column on
  // conversation_participants either), but is still resolved so it exists
  // as a real user for any future audit trail need without a schema change.
  await resolveOrCreateResideActor({ ...actor, resideClientUid: tenantId });
  const { userId: participantUserId } = await resolveOrCreateResideActor({
    ...participant,
    resideClientUid: tenantId,
  });

  try {
    // Write against the resolved canonical id (Phase 7 merge redirect).
    const result = await createDomainService().addConversationParticipant(guard.conversation.id, {
      userId: participantUserId,
    });
    return Response.json({ participant: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique constraint/i.test(message)) {
      return Response.json({ error: "already a participant" }, { status: 409 });
    }
    throw err;
  }
}
