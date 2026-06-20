import Link from "next/link";
import { redirect } from "next/navigation";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Separator } from "@/components/ui/separator";
import { getActiveTenantId, getUserMemberships } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const memberships = await getUserMemberships();
  const activeTenantId = await getActiveTenantId();
  const tenants = memberships.map((m) => m.tenant);

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="px-4 py-5">
          <Link href="/inbox" className="text-lg font-semibold tracking-tight">
            Contact
          </Link>
          <p className="mt-1 text-xs text-zinc-500">Customer inbox</p>
        </div>
        <Separator />
        <div className="py-3">
          <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Tenant
          </p>
          {activeTenantId && (
            <TenantSwitcher
              tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
              activeTenantId={activeTenantId}
            />
          )}
        </div>
        <Separator />
        <nav className="flex flex-col gap-1 p-3 text-sm">
          <Link
            href="/inbox"
            className="rounded-md px-3 py-2 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Inbox
          </Link>
        </nav>
        <div className="mt-auto border-t border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800">
          {user.email}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
