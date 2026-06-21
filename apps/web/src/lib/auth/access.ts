import { createDomainService } from "@contact/database";
import { requireSession } from "./session";

export async function requireTenantMembership(tenantId: string) {
  const session = await requireSession();
  if (!session) return null;

  const domain = createDomainService();
  const memberships = await domain.getUserTenants(session.user.id);
  if (!memberships.some((m) => m.tenant.id === tenantId)) return null;

  return { session, domain, memberships };
}

export async function assertConversationAccess(conversationId: string) {
  const session = await requireSession();
  if (!session) return null;

  const domain = createDomainService();
  const thread = await domain.getConversationThread(conversationId);
  if (!thread) return null;

  const memberships = await domain.getUserTenants(session.user.id);
  if (!memberships.some((m) => m.tenant.id === thread.tenant_id)) return null;

  return { session, thread, domain };
}
