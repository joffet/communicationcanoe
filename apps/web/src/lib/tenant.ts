import { TENANT_COOKIE } from "@contact/shared/constants";
import { cookies } from "next/headers";
import { createDomainService } from "@contact/database";
import { requireSession } from "@/lib/auth/session";

export async function getActiveTenantId(): Promise<string | null> {
  const session = await requireSession();
  if (!session) return null;

  const domain = createDomainService();
  const memberships = await domain.getUserTenants(session.user.id);
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

  const domain = createDomainService();
  return domain.getUserTenants(session.user.id);
}

export async function getSessionUser() {
  const session = await requireSession();
  return session?.user ?? null;
}
