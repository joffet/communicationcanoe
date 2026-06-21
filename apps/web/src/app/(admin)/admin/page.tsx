import Link from "next/link";
import { createAdminService } from "@communication-canoe/database";
import {
  adminPageContainerClassName,
  adminPageTitleClassName,
} from "@/components/admin/admin-table-layout";
import { requireSuperAdmin } from "@/lib/auth/access";

export default async function AdminDashboardPage() {
  const { session, admin } = await requireSuperAdmin();
  const stats = await admin.getAdminStats();

  return (
    <div className={adminPageContainerClassName}>
      <div>
        <h1 className={adminPageTitleClassName}>Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {session.user.email}
          </span>
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Tenants" value={stats.tenantCount} href="/admin/tenants" />
        <StatCard label="Users" value={stats.userCount} href="/admin/users" />
        <StatCard
          label="Super admins"
          value={stats.superAdminCount}
          href="/admin/users"
        />
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/admin/tenants/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add tenant
        </Link>
        <Link
          href="/admin/users/new"
          className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
        >
          Add user
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </Link>
  );
}
