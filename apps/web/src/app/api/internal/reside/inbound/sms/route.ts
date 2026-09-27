import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideInboundSmsInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { ingestInboundSms } from "@/lib/inbound/sms";

/**
 * Inbound resident texts forwarded by reside. Tenants' Twilio numbers point at
 * reside's /api/sms/inbound, which handles STOP/START itself and sends every
 * other message here - without this, those texts never reached the inbox.
 * Lands them through the same path as /api/webhooks/twilio/sms.
 */
export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideInboundSmsInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId: resideClientUid, from, to, body, messageSid } = parsed.data;

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  // reside picked the client from the number the text was sent to; if that
  // number is not this tenant's, the two systems disagree about who owns it
  // and the message would land in the wrong inbox. Refuse loudly instead.
  const domain = createDomainService();
  const byNumber = await domain.resolveTenantByPhone(to);
  if (byNumber?.id !== tenant.id) {
    return Response.json({ error: "`to` is not this tenant's Twilio number" }, { status: 409 });
  }

  const result = await ingestInboundSms(domain, {
    tenantId: tenant.id,
    from,
    body,
    idempotencyKey: `twilio-sms:${messageSid}`,
  });

  return Response.json(result);
}
