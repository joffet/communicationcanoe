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

  const { tenantId: resideClientUid, channel, body, subject, recipients, from, attachments } =
    parsed.data;

  const admin = createAdminService();
  const tenant = await admin.getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  const domain = createDomainService();
  const batch = await domain.createOutboundBatch({
    tenantId,
    channel,
    subject,
    body,
    recipients,
    from,
    // Persisted as sent. Resolving or fetching one here would pay the cost
    // before the batch is even queued, and would bake a fetch target into a
    // row the worker drains later - see outboundBatches.attachments.
    attachments,
  });

  return Response.json({ batchId: batch.id, totalRecipients: batch.totalRecipients });
}
