import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav.client";
import { getSessionUser, getIsSuperAdmin } from "@/lib/tenant";

export const metadata = {
  title: "Admin · Communication Canoe",
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  const isSuperAdmin = await getIsSuperAdmin();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {isSuperAdmin && user ? <AdminNav userEmail={user.email} /> : null}
      {children}
    </div>
  );
}
