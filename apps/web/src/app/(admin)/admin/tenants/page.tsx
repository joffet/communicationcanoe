import { createAdminService } from "@communication-canoe/database";
import { adminPageContainerClassName } from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";
import { TenantsViewAll } from "./tenants-view-all.client";

export default async function AdminTenantsPage() {
  await requireSuperAdmin();
  const admin = createAdminService();
  const tenants = await admin.listAllTenants();

  return (
    <div className={adminPageContainerClassName}>
      <TenantsViewAll tenants={tenants} />
    </div>
  );
}
