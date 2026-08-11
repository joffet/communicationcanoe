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
  const { tenantId, contact } = parsed.data;

  const identity = await findResidentIdentity(tenantId, contact);
  if (!identity) {
    return new Response("Unknown conversation", { status: 404 });
  }

  const guard = await resolveOwnedConversation(tenantId, id, identity.id);
  if (!guard.ok) {
    return new Response("Unknown conversation", { status: guard.status });
  }

  return Response.json({ conversation: toMemberSafeThread(guard.conversation) });
}
