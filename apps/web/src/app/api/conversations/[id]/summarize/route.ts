import { createClient } from "@/lib/supabase/server";
import { createDomainService } from "@contact/database";
import { summarizeConversation } from "@contact/shared/ai";

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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await assertConversationAccess(id);
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const summary = await summarizeConversation({
    messages: ctx.thread.messages.map((m) => ({
      channel: m.channel,
      direction: m.direction,
      body: m.body,
      createdAt: m.created_at,
    })),
  });

  await ctx.domain.updateConversationSummary(id, summary);
  return Response.json({ summary });
}
