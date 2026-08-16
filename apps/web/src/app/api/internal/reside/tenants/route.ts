import { createAdminService } from "@communication-canoe/database";
import { provisionTenantInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

function serializeTenant(tenant: {
  id: string;
  name: string;
  twilio_number: string;
  inbound_email_address: string;
  reside_app_url: string | null;
  chat_widget_key: string;
  provisioning_source: string;
  created_at: string;
}) {
  return {
    id: tenant.id,
    name: tenant.name,
    twilioNumber: tenant.twilio_number,
    inboundEmailAddress: tenant.inbound_email_address,
    resideAppUrl: tenant.reside_app_url,
    chatWidgetKey: tenant.chat_widget_key,
    provisioningSource: tenant.provisioning_source,
    createdAt: tenant.created_at,
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
    if (resideAppUrl !== undefined && resideAppUrl !== existing.reside_app_url) {
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
      twilio_number: twilioNumber,
      inbound_email_address: inboundEmailAddress,
      provisioning_source: "reside",
      reside_client_uid: resideClientUid,
      reside_app_url: resideAppUrl ?? null,
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
