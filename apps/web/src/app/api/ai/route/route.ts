import { createDomainService } from "@communication-canoe/database";
import { routeConversation } from "@communication-canoe/shared/ai";

function verifyInternalSecret(request: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return true;
  return request.headers.get("x-internal-secret") === secret;
}

export async function POST(request: Request) {
  if (!verifyInternalSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { conversationId?: string; tenantId?: string };
  if (!body.conversationId || !body.tenantId) {
    return new Response("Missing conversationId or tenantId", { status: 400 });
  }

  const domain = createDomainService();
  const thread = await domain.getConversationThread(body.conversationId);
  if (!thread || thread.tenant_id !== body.tenantId) {
    return new Response("Conversation not found", { status: 404 });
  }

  if (thread.assigned_team_id) {
    return Response.json({ teamId: thread.assigned_team_id, reasoning: "Already assigned" });
  }

  const teams = await domain.getTeamsForTenant(body.tenantId);
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) {
    return Response.json({ teamId: null, reasoning: "No inbound message" });
  }

  const result = await routeConversation({
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    messagePreview: lastInbound.body,
  });

  if (result.teamId) {
    await domain.assignConversationTeam(body.conversationId, result.teamId);
  }

  return Response.json(result);
}
