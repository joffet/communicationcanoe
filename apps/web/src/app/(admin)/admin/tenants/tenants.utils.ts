import type { AdminTenantRow } from "@communication-canoe/database";

export type TenantsSortField = "name" | "created_at" | "member_count";

export type SortConfig = {
  field: TenantsSortField;
  direction: "asc" | "desc";
};

export const DEFAULT_TENANTS_SORT: SortConfig = {
  field: "name",
  direction: "asc",
};

export function sortTenants(
  tenants: AdminTenantRow[],
  config: SortConfig,
): AdminTenantRow[] {
  const sorted = [...tenants];
  const dir = config.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (config.field) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "member_count":
        return (a.member_count - b.member_count) * dir;
      case "created_at":
        return (
          (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
          dir
        );
      default:
        return 0;
    }
  });

  return sorted;
}

export function tenantMatchesSearch(tenant: AdminTenantRow, query: string): boolean {
  const q = query.toLowerCase();
  return (
    tenant.name.toLowerCase().includes(q) ||
    tenant.twilio_number.toLowerCase().includes(q) ||
    tenant.inbound_email_address.toLowerCase().includes(q)
  );
}

export function formatTenantDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
