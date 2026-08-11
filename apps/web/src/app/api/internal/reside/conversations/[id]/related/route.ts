import { createDomainService } from "@communication-canoe/database";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  const guard = await resolveTenantScopedConversation(tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // Read-only, no actor - surfaces this resident's other conversations
  // (across their full identity merge-chain) as candidates for the
  // Phase 7 merge action.
  const conversations = await createDomainService().listRelatedConversations(tenantId, guard.conversation.id);
  return Response.json({ conversations });
}
