"use client";

import { useMemo, useRef, useState } from "react";
import type { AdminUserRow } from "@communication-canoe/database";
import {
  adminSearchToolbarIconToggle,
  shouldRunAdminSearch,
} from "@/lib/admin-list/search";
import { ToggleFilterDialog } from "@/components/admin/toggle-filter-dialog";
import { UsersToolbar } from "./users-toolbar.client";
import { UsersTableSection } from "./users-table-section.client";
import {
  countNonDefaultUserFilters,
  DEFAULT_USERS_FILTER,
  userPassesAdminFilters,
  type UsersFilterState,
} from "./user-filters.utils";
import {
  DEFAULT_USERS_SORT,
  sortUsers,
  userMatchesSearch,
  type SortConfig,
} from "./users.utils";

type UsersViewAllProps = {
  users: AdminUserRow[];
};

export function UsersViewAll({ users }: UsersViewAllProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_USERS_SORT);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [userFilter, setUserFilter] = useState<UsersFilterState>(DEFAULT_USERS_FILTER);

  const nonDefaultFilterCount = countNonDefaultUserFilters(userFilter);

  const sortedUsers = useMemo(() => {
    const searchTrim = searchInput.trim();
    const filtered = users.filter((user) => {
      if (!userPassesAdminFilters(user, userFilter)) return false;
      if (shouldRunAdminSearch(searchTrim)) {
        return userMatchesSearch(user, searchTrim);
      }
      return true;
    });
    return sortUsers(filtered, sortConfig);
  }, [users, userFilter, searchInput, sortConfig]);

  return (
    <>
      <UsersToolbar
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        nonDefaultFilterCount={nonDefaultFilterCount}
        onOpenFilter={() => setFilterOpen(true)}
        searchOpen={searchOpen}
        onToggleSearch={() =>
          adminSearchToolbarIconToggle(searchOpen, setSearchOpen, setSearchInput)
        }
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        searchInputRef={searchInputRef}
      />
      <UsersTableSection users={sortedUsers} />
      <ToggleFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title="Filter users"
        rows={[
          {
            id: "superAdmins",
            label: "Super admins",
            checked: userFilter.showSuperAdmins,
            onCheckedChange: (checked) =>
              setUserFilter((prev) => ({ ...prev, showSuperAdmins: checked })),
          },
          {
            id: "regularUsers",
            label: "Regular users",
            checked: userFilter.showRegularUsers,
            onCheckedChange: (checked) =>
              setUserFilter((prev) => ({ ...prev, showRegularUsers: checked })),
          },
          {
            id: "hasTenant",
            label: "Has tenant membership",
            checked: userFilter.showHasTenant,
            onCheckedChange: (checked) =>
              setUserFilter((prev) => ({ ...prev, showHasTenant: checked })),
          },
          {
            id: "noTenant",
            label: "No tenant membership",
            checked: userFilter.showNoTenant,
            onCheckedChange: (checked) =>
              setUserFilter((prev) => ({ ...prev, showNoTenant: checked })),
          },
        ]}
      />
    </>
  );
}
