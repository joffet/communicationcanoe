"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdminAction } from "@/lib/auth/access";

export async function createTenantAction(input: {
  name: string;
  twilio_number: string;
  inbound_email_address: string;
}) {
  const gate = await requireSuperAdminAction();
  if (!gate.ok) return { ok: false as const, message: gate.message };

  if (!input.name.trim()) {
    return { ok: false as const, message: "Name is required." };
  }
  if (!input.twilio_number.trim()) {
    return { ok: false as const, message: "Twilio number is required." };
  }
  if (!input.inbound_email_address.trim()) {
    return { ok: false as const, message: "Inbound email is required." };
  }

  try {
    const tenant = await gate.admin.createTenant({
      name: input.name,
      twilio_number: input.twilio_number,
      inbound_email_address: input.inbound_email_address,
    });
    revalidatePath("/admin/tenants");
    redirect(`/admin/tenants/${tenant.id}/edit`);
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Failed to create tenant.",
    };
  }
}

export async function updateTenantAction(
  id: string,
  input: {
    name: string;
    twilio_number: string;
    inbound_email_address: string;
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
