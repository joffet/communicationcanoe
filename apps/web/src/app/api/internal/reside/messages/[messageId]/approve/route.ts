import { z } from "zod";
import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideApproveFlaggedMessageInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

// Admin override for a message the tone-review worker flagged (or hasn't
// finished reviewing yet) - unblocks Phase 3's scheduled-message-worker gate
// immediately. Mirrors messages/[messageId]/cancel/route.ts's exact shape.
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

  const parsed = resideApproveFlaggedMessageInputSchema.safeParse(await request.json());
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

  // Best-effort: no-ops (returns approved: false) if the message was already
  // approved or the scheduled-message-worker already claimed it.
  const approved = await domain.approveFlaggedMessage(messageId);
  return Response.json({ approved: Boolean(approved) });
}
