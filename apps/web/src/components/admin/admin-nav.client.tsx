"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";

type AdminNavProps = {
  userEmail: string;
};

function navLinkClass(active: boolean) {
  return active
    ? "font-medium text-zinc-900 dark:text-zinc-100"
    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100";
}

export function AdminNav({ userEmail }: AdminNavProps) {
  const pathname = usePathname();

  if (pathname === "/admin/forbidden") {
    return null;
  }

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="text-lg font-semibold tracking-tight">
            Communication Canoe
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link
              href="/admin"
              className={navLinkClass(pathname === "/admin")}
            >
              Dashboard
            </Link>
            <Link
              href="/admin/tenants"
              className={navLinkClass(
                pathname === "/admin/tenants" ||
                  pathname.startsWith("/admin/tenants/"),
              )}
            >
              Tenants
            </Link>
            <Link
              href="/admin/users"
              className={navLinkClass(
                pathname === "/admin/users" ||
                  pathname.startsWith("/admin/users/"),
              )}
            >
              Users
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/inbox" className="text-zinc-500 hover:text-zinc-900">
            Inbox
          </Link>
          <span className="text-zinc-500">{userEmail}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
