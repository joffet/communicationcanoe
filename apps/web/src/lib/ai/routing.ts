import { createDomainService } from "@contact/database";
import { routeConversation } from "@contact/shared/ai";

export async function triggerConversationRouting(conversationId: string, tenantId: string) {
  const domain = createDomainService();
  const thread = await domain.getConversationThread(conversationId);
  if (!thread || thread.assigned_team_id) return;

  const teams = await domain.getTeamsForTenant(tenantId);
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) return;

  const result = await routeConversation({
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    messagePreview: lastInbound.body,
  });

  if (result.teamId) {
    await domain.assignConversationTeam(conversationId, result.teamId);
  }
}
