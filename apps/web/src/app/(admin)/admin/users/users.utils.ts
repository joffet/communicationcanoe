export type UsersSortField = "name" | "email" | "createdAt" | "platform_role";

export const DEFAULT_USERS_SORT: SortConfig<UsersSortField> = {
  field: "email",
  direction: "asc",
};

export function sortUsers(users: AdminUser[], config: SortConfig<UsersSortField>): AdminUser[] {
  const sorted = [...users];
  const dir = config.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (config.field) {
      case "name":
        return (a.name ?? a.email).localeCompare(b.name ?? b.email) * dir;
      case "email":
        return a.email.localeCompare(b.email) * dir;
      case "platform_role":
        return a.platformRole.localeCompare(b.platformRole) * dir;
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

export function userMatchesSearch(user: AdminUser, query: string): boolean {
  const q = query.toLowerCase();
  return (
    user.email.toLowerCase().includes(q) ||
    (user.name?.toLowerCase().includes(q) ?? false) ||
    user.memberships.some((m) => m.tenantName.toLowerCase().includes(q))
  );
}

export function formatMembershipSummary(user: AdminUser): string {
  if (user.memberships.length === 0) return "—";
  if (user.memberships.length === 1) {
    const m = user.memberships[0]!;
    return `${m.tenantName} (${m.role})`;
  }
  return `${user.memberships.length} tenants`;
}

export function formatUserDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
