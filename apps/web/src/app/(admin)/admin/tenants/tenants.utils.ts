export type TenantsSortField = "name" | "createdAt" | "memberCount";

export const DEFAULT_TENANTS_SORT: SortConfig<TenantsSortField> = {
  field: "name",
  direction: "asc",
};

export function sortTenants(
  tenants: AdminTenant[],
  config: SortConfig<TenantsSortField>,
): AdminTenant[] {
  const sorted = [...tenants];
  const dir = config.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (config.field) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "memberCount":
        return (a.memberCount - b.memberCount) * dir;
      case "createdAt":
        return (
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
          dir
        );
      default:
        return 0;
    }
  });

  return sorted;
}

export function tenantMatchesSearch(tenant: AdminTenant, query: string): boolean {
  const q = query.toLowerCase();
  return (
    tenant.name.toLowerCase().includes(q) ||
    tenant.twilioNumber.toLowerCase().includes(q) ||
    tenant.inboundEmailAddress.toLowerCase().includes(q)
  );
}

export function formatTenantDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
