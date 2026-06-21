import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminService } from "@communication-canoe/database";
import {
  adminPageContainerClassName,
  adminPageTitleClassName,
} from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";
import { UserForm } from "../../user-form.client";

type EditUserPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditUserPage({ params }: EditUserPageProps) {
  await requireSuperAdmin();
  const { id } = await params;
  const admin = createAdminService();
  const [user, tenants] = await Promise.all([
    admin.getUserById(id),
    admin.listAllTenants(),
  ]);
  if (!user) notFound();

  return (
    <div className={adminPageContainerClassName}>
      <Link
        href="/admin/users"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← Users
      </Link>
      <h1 className={`${adminPageTitleClassName} mt-4`}>Edit user</h1>
      <p className="mt-1 text-sm text-zinc-500">{user.email}</p>
      <div className="mt-6">
        <UserForm user={user} tenants={tenants} />
      </div>
    </div>
  );
}
