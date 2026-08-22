"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdminAction } from "@/lib/auth/access";
import { invitePlatformUser } from "@/lib/auth/invite-user";

export async function createUserAction(input: {
  email: string;
  name?: string | null;
  sendInvite: boolean;
  platformRole: "user" | "super_admin";
  memberships: UserMembershipInput[];
}) {
  const gate = await requireSuperAdminAction();
  if (!gate.ok) return { ok: false as const, message: gate.message };

  const inviteResult = await invitePlatformUser({
    email: input.email,
    name: input.name,
    sendInvite: input.sendInvite,
    platformRole: input.platformRole,
    callbackPath: "/inbox",
  });

  if (!inviteResult.ok) {
    return { ok: false as const, message: inviteResult.message };
  }

  if (input.memberships.length > 0) {
    await gate.admin.setUserTenantMemberships(
      inviteResult.userId,
      input.memberships,
    );
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users/${inviteResult.userId}/edit`);
}

export async function updateUserAction(
  id: string,
  input: {
    name?: string | null;
    phoneNumber?: string | null;
    availableForCalls: boolean;
    platformRole: "user" | "super_admin";
    memberships: UserMembershipInput[];
  },
) {
  const gate = await requireSuperAdminAction();
  if (!gate.ok) return { ok: false as const, message: gate.message };

  try {
    await gate.admin.updateUser(id, {
      name: input.name,
      phoneNumber: input.phoneNumber,
      availableForCalls: input.availableForCalls,
      platformRole: input.platformRole,
    });
    await gate.admin.setUserTenantMemberships(id, input.memberships);
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}/edit`);
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Failed to update user.",
    };
  }
}
