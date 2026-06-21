"use client";

import Link from "next/link";
import type { AdminTenantRow } from "@communication-canoe/database";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminTableClassName } from "@/components/admin/admin-table-layout";
import { formatTenantDate } from "./tenants.utils";

type TenantsTableSectionProps = {
  tenants: AdminTenantRow[];
};

export function TenantsTableSection({ tenants }: TenantsTableSectionProps) {
  if (tenants.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No tenants match your filters.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <Table className={adminTableClassName}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Twilio</TableHead>
            <TableHead>Inbound email</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => (
            <TableRow key={tenant.id}>
              <TableCell className="font-medium">{tenant.name}</TableCell>
              <TableCell className="font-mono text-xs">{tenant.twilio_number}</TableCell>
              <TableCell className="text-xs">{tenant.inbound_email_address}</TableCell>
              <TableCell>{tenant.member_count}</TableCell>
              <TableCell className="text-zinc-500">
                {formatTenantDate(tenant.created_at)}
              </TableCell>
              <TableCell>
                <Link
                  href={`/admin/tenants/${tenant.id}/edit`}
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
