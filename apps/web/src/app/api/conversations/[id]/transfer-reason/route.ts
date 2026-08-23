import { assertConversationAccess } from "@/lib/auth/access";

/**
 * Why the AI escalated this conversation, for the "needs human" banner.
 *
 * The bridge deliberately keeps this out of the needs_human Realtime payload —
 * chat:tenant:* is public — so the dashboard fetches it here, behind the same
 * tenant membership check as every other conversation route.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await assertConversationAccess(id);
  if (!access) return new Response("Not found", { status: 404 });

  const transfer = await access.domain.getPendingLiveTransfer(
    id,
    access.thread.tenantId,
  );
  return Response.json({ reason: transfer?.reason ?? null });
}
