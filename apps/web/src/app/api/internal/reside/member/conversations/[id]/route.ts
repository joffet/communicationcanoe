import { createAdminService } from "@communication-canoe/database";
import { resideMemberThreadInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import {
  findResidentIdentity,
  resolveOwnedConversation,
  toMemberSafeThread,
} from "@/lib/reside/member-conversation-guard";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideMemberThreadInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId: resideClientUid, contact } = parsed.data;

  // Two different identifiers are in play here, and mixing them up silently
  // 404s every request rather than erroring:
  //   - findResidentIdentity queries identities.tenant_id, a UUID column, so
  //     it needs comm-canoe's internal id.
  //   - resolveOwnedConversation takes reside's client uid and resolves the
  //     tenant itself.
  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown conversation", { status: 404 });
  }

  const identity = await findResidentIdentity(tenant.id, contact);
  if (!identity) {
    return new Response("Unknown conversation", { status: 404 });
  }

  const guard = await resolveOwnedConversation(resideClientUid, id, identity.id);
  if (!guard.ok) {
    return new Response("Unknown conversation", { status: guard.status });
  }

  return Response.json({ conversation: toMemberSafeThread(guard.conversation) });
}
