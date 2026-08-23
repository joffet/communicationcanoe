import { createDomainService } from "@communication-canoe/database";
import { routeConversation } from "@communication-canoe/shared/ai";
import type { TenantId } from "@communication-canoe/database";

/**
 * Both ids are required to agree, so this checks that they do.
 *
 * getConversationThread takes no tenant and cannot check one - it is on the
 * caller-enforced register in packages/database, and this is a caller. Today
 * both call sites (the Twilio and Postmark inbound webhooks) derive the
 * conversation from findOrCreateConversation(tenant.id, ...), so the pair
 * cannot diverge and the check never fires.
 *
 * It is here for the third caller. This function ends in
 * assignConversationTeam, which takes no tenant either: hand it a team from
 * one tenant and a conversation from another and it will attach them, which
 * tenant-isolation.test.ts asserts as executable fact. A caller that took its
 * tenant from a session and its conversation from a URL would cross the
 * boundary silently, and that is precisely the shape of the two route bugs
 * fixed in #11 and 0d4cc2e.
 */
export async function triggerConversationRouting(conversationId: string, tenantId: TenantId) {
  const domain = createDomainService();
  const thread = await domain.getConversationThread(conversationId);
  if (!thread || thread.tenantId !== tenantId || thread.assignedTeamId) return;

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
