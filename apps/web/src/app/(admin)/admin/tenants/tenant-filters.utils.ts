export type TenantsFilterState = {
  showHasMembers: boolean;
  showNoMembers: boolean;
};

export const DEFAULT_TENANTS_FILTER: TenantsFilterState = {
  showHasMembers: true,
  showNoMembers: true,
};

export function tenantPassesAdminFilters(
  tenant: AdminTenant,
  filter: TenantsFilterState,
): boolean {
  const hasMembers = tenant.memberCount > 0;
  if (hasMembers && !filter.showHasMembers) return false;
  if (!hasMembers && !filter.showNoMembers) return false;
  return true;
}

export function countNonDefaultTenantFilters(filter: TenantsFilterState): number {
  let count = 0;
  if (!filter.showHasMembers) count += 1;
  if (!filter.showNoMembers) count += 1;
  return count;
}
