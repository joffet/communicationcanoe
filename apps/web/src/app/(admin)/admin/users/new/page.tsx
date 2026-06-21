import Link from "next/link";
import { createAdminService } from "@communication-canoe/database";
import {
  adminPageContainerClassName,
  adminPageTitleClassName,
} from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";
import { UserForm } from "../user-form.client";

export default async function NewUserPage() {
  await requireSuperAdmin();
  const admin = createAdminService();
  const tenants = await admin.listAllTenants();

  return (
    <div className={adminPageContainerClassName}>
      <Link
        href="/admin/users"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← Users
      </Link>
      <h1 className={`${adminPageTitleClassName} mt-4`}>New user</h1>
      <div className="mt-6">
        <UserForm tenants={tenants} />
      </div>
    </div>
  );
}
