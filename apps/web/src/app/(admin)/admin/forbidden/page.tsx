import Link from "next/link";
import { adminPageContainerClassName } from "@/components/admin/admin-table-layout";

export default function AdminForbiddenPage() {
  return (
    <div className={adminPageContainerClassName}>
      <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Super admin access is required to view this area.
      </p>
      <div className="mt-6 flex gap-4 text-sm">
        <Link href="/inbox" className="text-zinc-900 underline dark:text-zinc-100">
          Back to inbox
        </Link>
        <Link href="/login" className="text-zinc-500 underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
