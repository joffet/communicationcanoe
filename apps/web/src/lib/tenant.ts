import { TENANT_COOKIE } from "@communication-canoe/shared/constants";
import { cookies } from "next/headers";
import { createAdminService, createDomainService } from "@communication-canoe/database";
import { requireSession } from "@/lib/auth/session";

export async function getActiveTenantId(): Promise<string | null> {
  const session = await requireSession();
  if (!session) return null;

  const admin = createAdminService();
  const isSuper = await admin.isSuperAdmin(session.user.id);

  const domain = createDomainService();
  const memberships = isSuper
    ? (await admin.listAllTenants()).map((t) => ({
        role: "admin" as const,
        tenant: t,
      }))
    : await domain.getUserTenants(session.user.id);

  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const selected = cookieStore.get(TENANT_COOKIE)?.value;
  if (selected && memberships.some((m) => m.tenant.id === selected)) {
    return selected;
  }

  return memberships[0]?.tenant.id ?? null;
}

export async function getUserMemberships() {
  const session = await requireSession();
  if (!session) return [];

  const admin = createAdminService();
  const isSuper = await admin.isSuperAdmin(session.user.id);
  if (isSuper) {
    const tenants = await admin.listAllTenants();
    return tenants.map((t) => ({ role: "admin" as const, tenant: t }));
  }

  const domain = createDomainService();
  return domain.getUserTenants(session.user.id);
}

export async function getSessionUser() {
  const session = await requireSession();
  return session?.user ?? null;
}

export async function getIsSuperAdmin(): Promise<boolean> {
  const session = await requireSession();
  if (!session) return false;
  const admin = createAdminService();
  return admin.isSuperAdmin(session.user.id);
}
