import { createAdminService } from "@communication-canoe/database";
import { provisionTenantInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

function serializeTenant(tenant: {
  id: string;
  name: string;
  twilio_number: string;
  inbound_email_address: string;
  chat_widget_key: string;
  provisioning_source: string;
  created_at: string;
}) {
  return {
    id: tenant.id,
    name: tenant.name,
    twilioNumber: tenant.twilio_number,
    inboundEmailAddress: tenant.inbound_email_address,
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

  const { resideClientUid, name, twilioNumber, inboundEmailAddress } = parsed.data;
  const admin = createAdminService();

  const existing = await admin.getTenantById(resideClientUid);
  if (existing) {
    return Response.json({ tenant: serializeTenant(existing) });
  }

  try {
    const tenant = await admin.createTenant({
      id: resideClientUid,
      name,
      twilio_number: twilioNumber,
      inbound_email_address: inboundEmailAddress,
      provisioning_source: "reside",
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
