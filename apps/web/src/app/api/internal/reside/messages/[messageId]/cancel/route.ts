import { z } from "zod";
import { createDomainService } from "@communication-canoe/database";
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
  const existing = await domain.getMessageById(messageId);
  if (!existing || existing.tenant_id !== parsed.data.tenantId) {
    return new Response("Unknown message", { status: 404 });
  }

  // Best-effort: no-ops (returns canceled: false) if the scheduled-message-
  // worker already claimed it for dispatch - see claimScheduledMessage's
  // race-safety note.
  const canceled = await domain.cancelScheduledMessage(messageId);
  return Response.json({ canceled: Boolean(canceled) });
}
