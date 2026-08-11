import { createDomainService } from "@communication-canoe/database";
import { verifyResideSecret } from "@/lib/reside/api-secret";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { batchId } = await params;
  const domain = createDomainService();
  const detail = await domain.getOutboundBatchDetail(batchId);
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
