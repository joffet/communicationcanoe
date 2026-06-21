import { assertConversationAccess } from "@/lib/auth/access";
import { summarizeConversation } from "@communication-canoe/shared/ai";

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
