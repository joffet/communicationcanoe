import { z } from "zod";
import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideCancelScheduledMessageInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messageId } = await params;
  if (!z.string().uuid().safeParse(messageId).success) {
    return new Response("Unknown message", { status: 404 });
  }

  const parsed = resideCancelScheduledMessageInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const domain = createDomainService();
  // parsed.data.tenantId is reside's client uid (possibly a slug); messages
  // store comm-canoe's internal uuid, so resolve before comparing. Comparing
  // the two directly silently 404s every request once they diverged.
  const tenant = await createAdminService().getTenantByResideClientUid(parsed.data.tenantId);
  if (!tenant) {
    return new Response("Unknown message", { status: 404 });
  }

  const existing = await domain.getMessageById(messageId);
  if (!existing || existing.tenant_id !== tenant.id) {
    return new Response("Unknown message", { status: 404 });
  }

  // Best-effort: no-ops (returns canceled: false) if the scheduled-message-
  // worker already claimed it for dispatch - see claimScheduledMessage's
  // race-safety note.
  const canceled = await domain.cancelScheduledMessage(messageId);
  return Response.json({ canceled: Boolean(canceled) });
}
