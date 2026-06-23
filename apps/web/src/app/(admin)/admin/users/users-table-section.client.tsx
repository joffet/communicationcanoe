"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminTableClassName } from "@/components/admin/admin-table-layout";
import {
  formatMembershipSummary,
  formatUserDate,
} from "./users.utils";

type UsersTableSectionProps = {
  users: AdminUserRow[];
};

export function UsersTableSection({ users }: UsersTableSectionProps) {
  if (users.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No users match your filters.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <Table className={adminTableClassName}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Tenants</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name ?? "—"}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                {user.platform_role === "super_admin" ? (
                  <Badge>Super admin</Badge>
                ) : (
                  <span className="text-zinc-500">User</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-zinc-600">
                {formatMembershipSummary(user)}
              </TableCell>
              <TableCell className="text-zinc-500">
                {formatUserDate(user.created_at)}
              </TableCell>
              <TableCell>
                <Link
                  href={`/admin/users/${user.id}/edit`}
                  className="text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
                >
                  Edit
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
