import Link from "next/link";
import {
  adminPageContainerClassName,
  adminPageTitleClassName,
} from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";
import { TenantForm } from "../tenant-form.client";

export default async function NewTenantPage() {
  await requireSuperAdmin();

  return (
    <div className={adminPageContainerClassName}>
      <Link
        href="/admin/tenants"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← Tenants
      </Link>
      <h1 className={`${adminPageTitleClassName} mt-4`}>New tenant</h1>
      <div className="mt-6">
        <TenantForm />
      </div>
    </div>
  );
}
