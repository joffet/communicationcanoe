import { createClient } from "@/lib/supabase/server";
import { createDomainService } from "@contact/database";
import { suggestReply } from "@contact/shared/ai";

async function assertConversationAccess(conversationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const domain = createDomainService();
  const thread = await domain.getConversationThread(conversationId);
  if (!thread) return null;

  const memberships = await domain.getUserTenants(user.id);
  if (!memberships.some((m) => m.tenant.id === thread.tenant_id)) return null;

  return { thread, domain };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await assertConversationAccess(id);
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const settings = await ctx.domain.getTenantSettings(ctx.thread.tenant_id);
  const examples = await ctx.domain.getResolvedConversationExamples(ctx.thread.tenant_id);

  const faqRaw = settings?.faq_snippets;
  const faqSnippets = Array.isArray(faqRaw)
    ? (faqRaw as Array<{ q?: string; a?: string }>).map((f) => ({
        q: f.q ?? "",
        a: f.a ?? "",
      }))
    : [];

  const draft = await suggestReply({
    conversationMessages: ctx.thread.messages.map((m) => ({
      direction: m.direction,
      body: m.body,
    })),
    resolvedExamples: examples,
    faqSnippets,
  });

  return Response.json({ draft });
}
