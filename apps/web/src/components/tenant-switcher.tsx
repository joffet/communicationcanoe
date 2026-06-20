"use client";

import { TENANT_COOKIE } from "@contact/shared/constants";
import { useRouter } from "next/navigation";

export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: Array<{ id: string; name: string }>;
  activeTenantId: string;
}) {
  const router = useRouter();

  if (tenants.length <= 1) {
    return (
      <div className="px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {tenants[0]?.name ?? "No tenant"}
      </div>
    );
  }

  return (
    <select
      className="mx-3 w-[calc(100%-1.5rem)] rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      value={activeTenantId}
      onChange={(e) => {
        document.cookie = `${TENANT_COOKIE}=${e.target.value}; path=/; max-age=31536000; SameSite=Lax`;
        router.refresh();
      }}
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
