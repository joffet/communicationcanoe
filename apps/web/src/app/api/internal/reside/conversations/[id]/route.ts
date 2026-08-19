import { createDomainService } from "@communication-canoe/database";
import { summarizeConversation } from "@communication-canoe/shared/ai";
import { resideUpdateConversationStatusInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";
import { findResideUserIdsForUsers } from "@/lib/reside/resolve-actor";

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

  // Phase 5: a reassignment UI can't show who's currently assigned from a
  // raw comm-canoe user_id alone - enrich each assignee with the reside
  // admin id it resolves to, so reside can match against its own admin list
  // and display a real name.
  const resideUserIdByUserId = await findResideUserIdsForUsers(
    guard.conversation.assignees.map((a) => a.userId),
  );

  // Phase 9: "how did this conversation come to exist via a split, if it
  // did" - the minimal admin-visibility mitigation for having no
  // per-split approval gate on AI-triggered splits.
  const splitOrigin = await createDomainService().getConversationSplitOrigin(guard.conversation.id);

  const conversation = {
    ...guard.conversation,
    assignees: guard.conversation.assignees.map((a) => ({
      ...a,
      reside_user_id: resideUserIdByUserId.get(a.userId) ?? null,
    })),
    splitOrigin,
  };

  return Response.json({ conversation });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideUpdateConversationStatusInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const guard = await resolveTenantScopedConversation(parsed.data.tenantId, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  // Write against the resolved canonical id, not the raw path param - a
  // stale link to a since-merged conversation (Phase 7) must update the
  // live thread, not a dead, invisible one.
  try {
    const domain = createDomainService();
    const conversation = await domain.updateConversationStatus(guard.conversation.id, parsed.data.status);

    // Phase 10 feeder-gap fix: conversations.summary was previously only
    // ever set via comm-canoe's own internal dashboard's manual "Summarize"
    // button, which reside doesn't expose - getResolvedConversationExamples
    // (suggestReply's resolved-examples feed) returned [] for essentially
    // every real reside tenant as a result. A summary is short, so this runs
    // inline rather than via a worker. Best-effort: a summarization failure
    // shouldn't block the status update that triggered it.
    if (parsed.data.status === "resolved") {
      try {
        const summary = await summarizeConversation({
          messages: guard.conversation.messages.map((m) => ({
            channel: m.channel,
            direction: m.direction,
            body: m.body,
            createdAt: m.created_at,
          })),
        });
        await domain.updateConversationSummary(guard.conversation.id, summary);
      } catch (err) {
        console.error(`[conversations/${guard.conversation.id}] auto-summarize failed:`, err);
      }
    }

    return Response.json({ conversation });
  } catch (err) {
    // updateConversationStatus throws a clean message on the
    // conversations_one_open_per_identity unique-violation (Phase 7) -
    // surface it as a 400, not an opaque 500.
    const message = err instanceof Error ? err.message : "Failed to update conversation status";
    return Response.json({ error: message }, { status: 400 });
  }
}
