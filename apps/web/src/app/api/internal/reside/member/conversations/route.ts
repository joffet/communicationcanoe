import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideMemberListInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { findResidentIdentity } from "@/lib/reside/member-conversation-guard";

export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideMemberListInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId: resideClientUid, contact } = parsed.data;

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  // Read-only lookup - a resident who's never contacted the building before
  // has no identity yet, which is a normal empty-inbox state, not an error.
  const identity = await findResidentIdentity(tenantId, contact);
  if (!identity) {
    return Response.json({ conversations: [] });
  }

  const conversations = await createDomainService().listConversationsForIdentity(tenantId, identity.id);

  return Response.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      status: c.status,
      summary: c.summary,
      created_at: c.createdAt,
      last_message_at: c.lastMessageAt,
    })),
  });
}
