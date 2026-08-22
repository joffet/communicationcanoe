import { createAdminService } from "@communication-canoe/database";
import { provisionTenantInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

function serializeTenant(tenant: {
  id: string;
  name: string;
  twilioNumber: string;
  inboundEmailAddress: string;
  resideAppUrl: string | null;
  chatWidgetKey: string;
  provisioningSource: string;
  createdAt: Date;
}) {
  return {
    id: tenant.id,
    name: tenant.name,
    twilioNumber: tenant.twilioNumber,
    inboundEmailAddress: tenant.inboundEmailAddress,
    resideAppUrl: tenant.resideAppUrl,
    chatWidgetKey: tenant.chatWidgetKey,
    provisioningSource: tenant.provisioningSource,
    createdAt: tenant.createdAt.toISOString(),
  };
}

export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = provisionTenantInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { resideClientUid, name, twilioNumber, inboundEmailAddress, resideAppUrl } = parsed.data;
  const admin = createAdminService();

  const existing = await admin.getTenantByResideClientUid(resideClientUid);
  if (existing) {
    // Provisioning is idempotent, but the portal URL can legitimately change
    // later (an admin edits their routing domain), so keep it in step rather
    // than returning a stale value.
    if (resideAppUrl !== undefined && resideAppUrl !== existing.resideAppUrl) {
      await admin.updateTenantResideAppUrl(resideClientUid, resideAppUrl);
      const refreshed = await admin.getTenantByResideClientUid(resideClientUid);
      if (refreshed) return Response.json({ tenant: serializeTenant(refreshed) });
    }
    return Response.json({ tenant: serializeTenant(existing) });
  }

  try {
    // `id` is left to be generated - reside's uid is stored in its own column
    // instead, since it may be a slug and `tenants.id` is a uuid.
    const tenant = await admin.createTenant({
      name,
      twilioNumber,
      inboundEmailAddress,
      provisioningSource: "reside",
      resideClientUid,
      resideAppUrl: resideAppUrl ?? null,
    });
    return Response.json({ tenant: serializeTenant(tenant) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isConflict = /duplicate key|unique constraint/i.test(message);
    return Response.json(
      { error: isConflict ? "twilioNumber or inboundEmailAddress already in use by another tenant" : message },
      { status: isConflict ? 409 : 500 },
    );
  }
}
