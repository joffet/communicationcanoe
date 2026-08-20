import { createDomainService } from "@communication-canoe/database";
import { createEmbeddingProvider, suggestReply } from "@communication-canoe/shared/ai";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { resolveTenantScopedConversation } from "@/lib/reside/conversation-guard";

// GET, not POST - suggestReply has no persisted side effect (mirrors the
// existing comm-canoe-internal-dashboard suggest-reply route's own GET
// convention), and retrieval is synchronous/on-demand rather than
// worker-driven, matching this feature's existing per-click AI UX.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  // reside's own client uid, which may be a slug - the settings/examples/chunk
  // lookups below key on the `tenant_id` uuid column, so they take the guard's
  // resolved id instead.
  const resideClientUid = new URL(request.url).searchParams.get("tenantId");
  if (!resideClientUid) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  const guard = await resolveTenantScopedConversation(resideClientUid, id);
  if (!guard.ok) return new Response("Unknown conversation", { status: guard.status });

  const commCanoeTenantId = guard.tenant.id;
  const domain = createDomainService();
  const [settings, examples] = await Promise.all([
    domain.getTenantSettings(commCanoeTenantId),
    domain.getResolvedConversationExamples(commCanoeTenantId),
  ]);

  const faqRaw = settings?.faqSnippets;
  const faqSnippets = Array.isArray(faqRaw)
    ? (faqRaw as Array<{ q?: string; a?: string }>).map((f) => ({ q: f.q ?? "", a: f.a ?? "" }))
    : [];

  // Embeds the latest inbound message as the retrieval query - the thing the
  // agent is actually trying to answer, not the whole thread.
  const latestInbound = [...guard.conversation.messages].reverse().find((m) => m.direction === "inbound");

  let retrievedChunks: Array<{ heading: string | null; content: string }> = [];
  if (latestInbound) {
    try {
      const embeddingProvider = createEmbeddingProvider();
      const [queryEmbedding] = await embeddingProvider.embed([latestInbound.body]);
      const chunks = await domain.findSimilarChunks(commCanoeTenantId, queryEmbedding);
      retrievedChunks = chunks.map((c) => ({ heading: c.heading, content: c.content }));
    } catch (err) {
      // Retrieval is a best-effort enhancement, not a hard dependency -
      // suggestReply still drafts from FAQ/resolved-examples/thread alone
      // if embedding/retrieval fails for any reason.
      console.error(`[suggest-reply] retrieval failed for conversation ${id}:`, err);
    }
  }

  const draft = await suggestReply({
    conversationMessages: guard.conversation.messages.map((m) => ({ direction: m.direction, body: m.body })),
    resolvedExamples: examples,
    faqSnippets,
    retrievedChunks,
  });

  return Response.json({ draft });
}
