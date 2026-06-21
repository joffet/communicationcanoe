import { createAdminService } from "@communication-canoe/database";
import { adminPageContainerClassName } from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";
import { UsersViewAll } from "./users-view-all.client";

export default async function AdminUsersPage() {
  await requireSuperAdmin();
  const admin = createAdminService();
  const users = await admin.listAllUsers();

  return (
    <div className={adminPageContainerClassName}>
      <UsersViewAll users={users} />
    </div>
  );
}
