import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminService, isTenantId } from "@communication-canoe/database";
import {
  adminPageContainerClassName,
  adminPageTitleClassName,
} from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";
import { TenantForm } from "../../tenant-form.client";

type EditTenantPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTenantPage({ params }: EditTenantPageProps) {
  await requireSuperAdmin();
  const { id } = await params;
  // This is comm-canoe's own admin URL, so `id` is a tenant uuid - but it is
  // still a path segment anyone can type. A malformed one is a 404 here rather
  // than a uuid cast error out of Postgres.
  if (!isTenantId(id)) notFound();

  const admin = createAdminService();
  const tenant = await admin.getTenantById(id);
  if (!tenant) notFound();

  return (
    <div className={adminPageContainerClassName}>
      <Link
        href="/admin/tenants"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← Tenants
      </Link>
      <h1 className={`${adminPageTitleClassName} mt-4`}>Edit tenant</h1>
      <p className="mt-1 text-sm text-zinc-500">{tenant.name}</p>
      <div className="mt-6">
        <TenantForm tenant={tenant} />
      </div>
    </div>
  );
}
