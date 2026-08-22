"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdminAction } from "@/lib/auth/access";

export async function createTenantAction(input: {
  name: string;
  twilioNumber: string;
  inboundEmailAddress: string;
}) {
  const gate = await requireSuperAdminAction();
  if (!gate.ok) return { ok: false as const, message: gate.message };

  if (!input.name.trim()) {
    return { ok: false as const, message: "Name is required." };
  }
  if (!input.twilioNumber.trim()) {
    return { ok: false as const, message: "Twilio number is required." };
  }
  if (!input.inboundEmailAddress.trim()) {
    return { ok: false as const, message: "Inbound email is required." };
  }

  let tenant;
  try {
    tenant = await gate.admin.createTenant(input);
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Failed to create tenant.",
    };
  }

  revalidatePath("/admin/tenants");
  // Outside the catch: redirect() signals by throwing, so catching it here
  // would swallow the navigation and surface "NEXT_REDIRECT" as a form error
  // on a tenant that was in fact created.
  redirect(`/admin/tenants/${tenant.id}/edit`);
}

export async function updateTenantAction(
  id: string,
  input: {
    name: string;
    twilioNumber: string;
    inboundEmailAddress: string;
  },
) {
  const gate = await requireSuperAdminAction();
  if (!gate.ok) return { ok: false as const, message: gate.message };

  if (!input.name.trim()) {
    return { ok: false as const, message: "Name is required." };
  }

  try {
    await gate.admin.updateTenant(id, input);
    revalidatePath("/admin/tenants");
    revalidatePath(`/admin/tenants/${id}/edit`);
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Failed to update tenant.",
    };
  }
}
