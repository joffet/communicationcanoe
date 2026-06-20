import { TENANT_COOKIE } from "@contact/shared/constants";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createDomainService } from "@contact/database";

export async function getActiveTenantId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const domain = createDomainService();
  const memberships = await domain.getUserTenants(user.id);
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const selected = cookieStore.get(TENANT_COOKIE)?.value;
  if (selected && memberships.some((m) => m.tenant.id === selected)) {
    return selected;
  }

  return memberships[0]?.tenant.id ?? null;
}

export async function getUserMemberships() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const domain = createDomainService();
  return domain.getUserTenants(user.id);
}
