import { createAdminService, createDomainService } from "@communication-canoe/database";
import { redirect } from "next/navigation";
import { requireSession } from "./session";

const MSG_SIGN_IN = "You must be signed in to perform this action.";
const MSG_SUPER_ADMIN_REQUIRED = "Super admin access is required.";

export async function getAppUser(userId: string) {
  const admin = createAdminService();
  return admin.getUserById(userId);
}

export async function isSuperAdminUser(userId: string): Promise<boolean> {
  const admin = createAdminService();
  return admin.isSuperAdmin(userId);
}

export async function requireSuperAdmin() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const admin = createAdminService();
  const isSuper = await admin.isSuperAdmin(session.user.id);
  if (!isSuper) redirect("/admin/forbidden");

  return { session, admin };
}

export async function requireSuperAdminAction(): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof requireSession>>>; admin: ReturnType<typeof createAdminService> }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (!session) return { ok: false, message: MSG_SIGN_IN };

  const admin = createAdminService();
  const isSuper = await admin.isSuperAdmin(session.user.id);
  if (!isSuper) return { ok: false, message: MSG_SUPER_ADMIN_REQUIRED };

  return { ok: true, session, admin };
}

export async function requireTenantMembership(tenantId: string) {
  const session = await requireSession();
  if (!session) return null;

  const domain = createDomainService();
  const admin = createAdminService();
  const isSuper = await admin.isSuperAdmin(session.user.id);

  if (isSuper) {
    const tenant = await admin.getTenantById(tenantId);
    if (!tenant) return null;
    const allTenants = await admin.listAllTenants();
    const memberships = allTenants.map((t) => ({
      role: "admin" as const,
      tenant: t,
    }));
    return { session, domain, memberships, isSuperAdmin: true as const };
  }

  const memberships = await domain.getUserTenants(session.user.id);
  if (!memberships.some((m) => m.tenant.id === tenantId)) return null;

  return { session, domain, memberships, isSuperAdmin: false as const };
}

export async function assertConversationAccess(conversationId: string) {
  const session = await requireSession();
  if (!session) return null;

  const domain = createDomainService();
  const admin = createAdminService();
  const thread = await domain.getConversationThread(conversationId);
  if (!thread) return null;

  const isSuper = await admin.isSuperAdmin(session.user.id);
  if (isSuper) {
    return { session, thread, domain, isSuperAdmin: true as const };
  }

  const memberships = await domain.getUserTenants(session.user.id);
  if (!memberships.some((m) => m.tenant.id === thread.tenant_id)) return null;

  return { session, thread, domain, isSuperAdmin: false as const };
}
