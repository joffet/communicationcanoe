import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideSendBulkMessageInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideSendBulkMessageInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { tenantId, channel, body, subject, recipients } = parsed.data;

  const admin = createAdminService();
  const tenant = await admin.getTenantById(tenantId);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  const domain = createDomainService();
  const batch = await domain.createOutboundBatch({
    tenantId,
    channel,
    subject,
    body,
    recipients,
  });

  return Response.json({ batchId: batch.id, totalRecipients: batch.total_recipients });
}
