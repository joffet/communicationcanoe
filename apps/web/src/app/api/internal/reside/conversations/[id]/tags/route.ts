import { createDomainService } from "@communication-canoe/database";
import { resideAddTagInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideAddTagInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // reside's own client uid, which may be a slug - the tag reads/writes below
  // key on the `tenant_id` uuid column, so they take the resolved id instead.
  const { tenantId: resideClientUid, tagName } = parsed.data;

  const guard = await resolveTenantScopedConversation(resideClientUid, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  const commCanoeTenantId = guard.tenant.id;
  const domain = createDomainService();

  // Tags have no actor column at all (confirmed in Phase 3 planning) - no
  // actor resolution needed for this write, unlike assignees/participants.
  const existing = await domain.listTenantTags(commCanoeTenantId);
  let tag = existing.find((t) => t.name.toLowerCase() === tagName.trim().toLowerCase());
  if (!tag) {
    try {
      tag = await domain.createTag(commCanoeTenantId, tagName.trim());
    } catch (err) {
      // Unique (tenant_id, name) constraint - a concurrent request created
      // the same tag first; re-fetch rather than fail the whole action.
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate key|unique constraint/i.test(message)) throw err;
      const retried = await domain.listTenantTags(commCanoeTenantId);
      const found = retried.find((t) => t.name.toLowerCase() === tagName.trim().toLowerCase());
      if (!found) throw err;
      tag = found;
    }
  }

  // Write against the resolved canonical id (Phase 7 merge redirect).
  await domain.addConversationTag(guard.conversation.id, tag.id);

  return Response.json({ tag });
}
