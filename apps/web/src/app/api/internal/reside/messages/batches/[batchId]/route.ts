import { z } from "zod";
import { createAdminService, createDomainService } from "@communication-canoe/database";
import { verifyResideSecret } from "@/lib/reside/api-secret";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { batchId } = await params;
  if (!z.string().uuid().safeParse(batchId).success) {
    return new Response("Unknown batch", { status: 404 });
  }

  // RESIDE_API_SECRET is shared across every building, so it authenticates
  // reside-the-service and proves nothing about which tenant is asking. Until
  // this route checked, any caller holding the secret could read any batch's
  // recipient list - contact addresses, delivery outcomes and open times - for
  // any other building, just by knowing its id. Every other GET under
  // internal/reside already took tenantId; this one was the exception.
  //
  // The uid may be a slug like "cardiff" while batches store comm-canoe's own
  // uuid, so it has to be resolved rather than compared directly - the same
  // step the cancel and approve routes make for the same reason.
  const url = new URL(request.url);
  const resideClientUidParsed = z.string().min(1).safeParse(url.searchParams.get("tenantId"));
  if (!resideClientUidParsed.success) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUidParsed.data);
  if (!tenant) {
    return new Response("Unknown batch", { status: 404 });
  }

  const domain = createDomainService();
  // Returns null for a batch belonging to another tenant, so a probe cannot
  // tell "not yours" from "does not exist".
  const detail = await domain.getOutboundBatchDetail(batchId, tenant.id);
  if (!detail) {
    return new Response("Unknown batch", { status: 404 });
  }

  return Response.json({
    status: detail.batch.status,
    totalRecipients: detail.batch.total_recipients,
    completedRecipients: detail.batch.completed_recipients,
    recipients: detail.recipients.map((r) => ({
      identity: r.identity_contact,
      status: r.status,
      deliveryStatus: r.deliveryStatus,
      deliveryError: r.deliveryError,
      openedAt: r.openedAt,
    })),
  });
}
