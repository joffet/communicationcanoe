export type UsersSortField = "name" | "email" | "created_at" | "platform_role";

export const DEFAULT_USERS_SORT: SortConfig<UsersSortField> = {
  field: "email",
  direction: "asc",
};

export function sortUsers(users: AdminUserRow[], config: SortConfig<UsersSortField>): AdminUserRow[] {
  const sorted = [...users];
  const dir = config.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (config.field) {
      case "name":
        return (a.name ?? a.email).localeCompare(b.name ?? b.email) * dir;
      case "email":
        return a.email.localeCompare(b.email) * dir;
      case "platform_role":
        return a.platform_role.localeCompare(b.platform_role) * dir;
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

export function userMatchesSearch(user: AdminUserRow, query: string): boolean {
  const q = query.toLowerCase();
  return (
    user.email.toLowerCase().includes(q) ||
    (user.name?.toLowerCase().includes(q) ?? false) ||
    user.memberships.some((m) => m.tenant_name.toLowerCase().includes(q))
  );
}

export function formatMembershipSummary(user: AdminUserRow): string {
  if (user.memberships.length === 0) return "—";
  if (user.memberships.length === 1) {
    const m = user.memberships[0]!;
    return `${m.tenant_name} (${m.role})`;
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
