"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { FilterToolbarButton } from "@/components/admin/filter-toolbar-button";
import {
  SearchToolbarButton,
  ToolbarSearchFieldRow,
} from "@/components/admin/search-toolbar-button";
import { SortByControl } from "@/components/admin/sort-by-control";
import { adminPageTitleClassName } from "@/components/admin/admin-table-layout";
import type { SortConfig, TenantsSortField } from "./tenants.utils";

type TenantsToolbarProps = {
  sortConfig: SortConfig;
  onSortChange: Dispatch<SetStateAction<SortConfig>>;
  nonDefaultFilterCount: number;
  onOpenFilter: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
};

const SORT_OPTIONS: { value: TenantsSortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "created_at", label: "Created" },
  { value: "member_count", label: "Members" },
];

export function TenantsToolbar({
  sortConfig,
  onSortChange,
  nonDefaultFilterCount,
  onOpenFilter,
  searchOpen,
  onToggleSearch,
  searchInput,
  onSearchInputChange,
  searchInputRef,
}: TenantsToolbarProps) {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={adminPageTitleClassName}>Tenants</h1>
        <Link
          href="/admin/tenants/new"
          className="inline-flex h-8 items-center gap-2 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Plus className="size-4" />
          Add tenant
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SortByControl
          value={sortConfig.field}
          direction={sortConfig.direction}
          onChange={(field, direction) => onSortChange({ field, direction })}
          options={SORT_OPTIONS}
        />
        <FilterToolbarButton
          nonDefaultCount={nonDefaultFilterCount}
          onOpen={onOpenFilter}
        />
        <SearchToolbarButton active={searchOpen} onToggle={onToggleSearch} />
      </div>
      {searchOpen ? (
        <ToolbarSearchFieldRow
          value={searchInput}
          onChange={onSearchInputChange}
          inputRef={searchInputRef}
          placeholder="Search tenants…"
        />
      ) : null}
    </div>
  );
}
