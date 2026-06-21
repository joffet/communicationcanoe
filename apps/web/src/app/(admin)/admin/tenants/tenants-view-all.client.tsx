"use client";

import { useMemo, useRef, useState } from "react";
import type { AdminTenantRow } from "@communication-canoe/database";
import {
  adminSearchToolbarIconToggle,
  shouldRunAdminSearch,
} from "@/lib/admin-list/search";
import { ToggleFilterDialog } from "@/components/admin/toggle-filter-dialog";
import { TenantsToolbar } from "./tenants-toolbar.client";
import { TenantsTableSection } from "./tenants-table-section.client";
import {
  countNonDefaultTenantFilters,
  DEFAULT_TENANTS_FILTER,
  tenantPassesAdminFilters,
  type TenantsFilterState,
} from "./tenant-filters.utils";
import {
  DEFAULT_TENANTS_SORT,
  sortTenants,
  tenantMatchesSearch,
  type SortConfig,
} from "./tenants.utils";

type TenantsViewAllProps = {
  tenants: AdminTenantRow[];
};

export function TenantsViewAll({ tenants }: TenantsViewAllProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_TENANTS_SORT);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tenantFilter, setTenantFilter] =
    useState<TenantsFilterState>(DEFAULT_TENANTS_FILTER);

  const nonDefaultFilterCount = countNonDefaultTenantFilters(tenantFilter);

  const sortedTenants = useMemo(() => {
    const searchTrim = searchInput.trim();
    const filtered = tenants.filter((tenant) => {
      if (!tenantPassesAdminFilters(tenant, tenantFilter)) return false;
      if (shouldRunAdminSearch(searchTrim)) {
        return tenantMatchesSearch(tenant, searchTrim);
      }
      return true;
    });
    return sortTenants(filtered, sortConfig);
  }, [tenants, tenantFilter, searchInput, sortConfig]);

  return (
    <>
      <TenantsToolbar
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
      <TenantsTableSection tenants={sortedTenants} />
      <ToggleFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title="Filter tenants"
        rows={[
          {
            id: "hasMembers",
            label: "Has members",
            checked: tenantFilter.showHasMembers,
            onCheckedChange: (checked) =>
              setTenantFilter((prev) => ({ ...prev, showHasMembers: checked })),
          },
          {
            id: "noMembers",
            label: "No members",
            checked: tenantFilter.showNoMembers,
            onCheckedChange: (checked) =>
              setTenantFilter((prev) => ({ ...prev, showNoMembers: checked })),
          },
        ]}
      />
    </>
  );
}
