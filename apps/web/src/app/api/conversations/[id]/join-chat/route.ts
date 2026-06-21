import { assertConversationAccess } from "@/lib/auth/access";
import {
  notifyBridgeAgentMessage,
  notifyBridgeHandoffJoin,
} from "@/lib/bridge/internal";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await assertConversationAccess(id);
  if (!access) return new Response("Not found", { status: 404 });

  await access.domain.assignConversationUser(id, access.session.user.id);

  const ok = await notifyBridgeHandoffJoin({
    conversationId: id,
    tenantId: access.thread.tenant_id,
    agentUserId: access.session.user.id,
    agentName: access.session.user.name ?? undefined,
  });

  return Response.json({ ok });
}
