import type { AdminUserRow } from "@communication-canoe/database";

export type UsersFilterState = {
  showSuperAdmins: boolean;
  showRegularUsers: boolean;
  showHasTenant: boolean;
  showNoTenant: boolean;
};

export const DEFAULT_USERS_FILTER: UsersFilterState = {
  showSuperAdmins: true,
  showRegularUsers: true,
  showHasTenant: true,
  showNoTenant: true,
};

export function userPassesAdminFilters(
  user: AdminUserRow,
  filter: UsersFilterState,
): boolean {
  const isSuper = user.platform_role === "super_admin";
  if (isSuper && !filter.showSuperAdmins) return false;
  if (!isSuper && !filter.showRegularUsers) return false;

  const hasTenant = user.memberships.length > 0;
  if (hasTenant && !filter.showHasTenant) return false;
  if (!hasTenant && !filter.showNoTenant) return false;

  return true;
}

export function countNonDefaultUserFilters(filter: UsersFilterState): number {
  let count = 0;
  if (!filter.showSuperAdmins) count += 1;
  if (!filter.showRegularUsers) count += 1;
  if (!filter.showHasTenant) count += 1;
  if (!filter.showNoTenant) count += 1;
  return count;
}
