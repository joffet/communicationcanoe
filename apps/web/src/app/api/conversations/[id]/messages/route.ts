import { assertConversationAccess } from "@/lib/auth/access";
import { notifyBridgeAgentMessage } from "@/lib/bridge/internal";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await assertConversationAccess(id);
  if (!access) return new Response("Not found", { status: 404 });

  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) return new Response("Missing text", { status: 400 });

  const message = await access.domain.appendMessage({
    tenantId: access.thread.tenant_id,
    conversationId: id,
    channel: "web_chat",
    direction: "outbound",
    senderType: "internal_user",
    senderId: access.session.user.id,
    body: text,
  });

  await notifyBridgeAgentMessage({
    conversationId: id,
    agentUserId: access.session.user.id,
    agentName: access.session.user.name ?? undefined,
    body: text,
    relayOnly: true,
  });

  return Response.json({ message });
}
