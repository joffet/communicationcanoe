"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createUserAction, updateUserAction } from "./actions";

type UserFormProps = {
  user?: AdminUserRow | null;
  tenants: Pick<Tenant, "id" | "name">[];
};

function membershipsFromUser(user?: AdminUserRow | null): UserMembershipInput[] {
  if (!user) return [];
  return user.memberships.map((m) => ({
    tenant_id: m.tenant_id,
    role: m.role,
  }));
}

export function UserForm({ user, tenants }: UserFormProps) {
  const router = useRouter();
  const isEdit = Boolean(user?.id);
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [phoneNumber, setPhoneNumber] = useState(user?.phone_number ?? "");
  const [availableForCalls, setAvailableForCalls] = useState(
    user?.available_for_calls ?? false,
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(
    user?.platform_role === "super_admin",
  );
  const [sendInvite, setSendInvite] = useState(true);
  const [memberships, setMemberships] = useState<UserMembershipInput[]>(
    membershipsFromUser(user),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addMembershipRow() {
    const unused = tenants.find(
      (t) => !memberships.some((m) => m.tenant_id === t.id),
    );
    if (!unused) return;
    setMemberships((prev) => [
      ...prev,
      { tenant_id: unused.id, role: "member" },
    ]);
  }

  function updateMembership(
    index: number,
    patch: Partial<UserMembershipInput>,
  ) {
    setMemberships((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeMembership(index: number) {
    setMemberships((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const platformRole = isSuperAdmin ? "super_admin" : "user";

    if (isEdit && user) {
      const result = await updateUserAction(user.id, {
        name: name.trim() || null,
        phone_number: phoneNumber.trim() || null,
        available_for_calls: availableForCalls,
        platform_role: platformRole,
        memberships,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess("Changes saved.");
      router.refresh();
      return;
    }

    const result = await createUserAction({
      email,
      name: name.trim() || null,
      sendInvite,
      platformRole,
      memberships,
    });
    setBusy(false);
    if (result && "message" in result && !result.ok) {
      setError(result.message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="max-w-xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="user-email">Email</Label>
        <Input
          id="user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy || isEdit}
          readOnly={isEdit}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-name">Name</Label>
        <Input
          id="user-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      {isEdit ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="user-phone">Phone</Label>
            <Input
              id="user-phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div>
              <Label htmlFor="user-calls">Available for calls</Label>
              <p className="text-xs text-zinc-500">Show as on-call eligible</p>
            </div>
            <Switch
              id="user-calls"
              checked={availableForCalls}
              onCheckedChange={setAvailableForCalls}
              disabled={busy}
            />
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <Label htmlFor="user-super-admin">Super admin</Label>
          <p className="text-xs text-zinc-500">Platform-wide admin access</p>
        </div>
        <Switch
          id="user-super-admin"
          checked={isSuperAdmin}
          onCheckedChange={setIsSuperAdmin}
          disabled={busy}
        />
      </div>

      {!isEdit ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <Label htmlFor="user-send-invite">Send sign-in email</Label>
            <p className="text-xs text-zinc-500">
              Email a magic link so they can sign in
            </p>
          </div>
          <Switch
            id="user-send-invite"
            checked={sendInvite}
            onCheckedChange={setSendInvite}
            disabled={busy}
          />
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Tenant memberships</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMembershipRow}
            disabled={busy || memberships.length >= tenants.length}
          >
            Add tenant
          </Button>
        </div>
        {memberships.length === 0 ? (
          <p className="text-sm text-zinc-500">No tenant memberships assigned.</p>
        ) : (
          <div className="space-y-2">
            {memberships.map((row, index) => (
              <div
                key={`${row.tenant_id}-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <Select
                  value={row.tenant_id}
                  onValueChange={(tenantId) =>
                    updateMembership(index, { tenant_id: tenantId })
                  }
                  disabled={busy}
                >
                  <SelectTrigger className="min-w-[180px] flex-1">
                    <SelectValue placeholder="Tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.role}
                  onValueChange={(role) =>
                    updateMembership(index, {
                      role: role as "admin" | "member",
                    })
                  }
                  disabled={busy}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMembership(index)}
                  disabled={busy}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-green-700">{success}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create user"}
        </Button>
        <Link
          href="/admin/users"
          className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-4 text-sm hover:bg-zinc-50 dark:border-zinc-800"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
