import { createAiProvider } from "./provider";
import type {
  RouteConversationInput,
  RouteConversationResult,
  SuggestReplyInput,
  SummarizeConversationInput,
} from "./types";

export async function routeConversation(
  input: RouteConversationInput,
): Promise<RouteConversationResult> {
  if (input.teams.length === 0) {
    return { teamId: null, reasoning: "No teams configured" };
  }

  const ai = createAiProvider();
  const teamList = input.teams.map((t) => `- ${t.id}: ${t.name}`).join("\n");

  const raw = await ai.complete({
    system:
      "You classify customer messages to the best team. Reply with JSON only: {\"teamId\":\"uuid-or-null\",\"reasoning\":\"short explanation\"}. Use null if unsure.",
    messages: [
      {
        role: "user",
        content: `Teams:\n${teamList}\n\nMessage:\n${input.messagePreview}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(raw) as RouteConversationResult;
    const validTeam = input.teams.find((t) => t.id === parsed.teamId);
    return {
      teamId: validTeam?.id ?? null,
      reasoning: parsed.reasoning ?? raw,
    };
  } catch {
    const fallback = input.teams[0];
    return { teamId: fallback?.id ?? null, reasoning: raw || "Fallback to first team" };
  }
}

export async function summarizeConversation(
  input: SummarizeConversationInput,
): Promise<string> {
  const ai = createAiProvider();
  const transcript = input.messages
    .map((m) => `[${m.channel}/${m.direction}] ${m.body}`)
    .join("\n");

  return ai.complete({
    system: "Summarize this customer conversation in 2-4 sentences for an internal inbox.",
    messages: [{ role: "user", content: transcript }],
  });
}

export async function suggestReply(input: SuggestReplyInput): Promise<string> {
  const ai = createAiProvider();
  const examples = input.resolvedExamples
    .map((e) => `Summary: ${e.summary ?? "n/a"}\nReply: ${e.sampleReply}`)
    .join("\n\n");
  const faq = input.faqSnippets.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n");
  const thread = input.conversationMessages
    .map((m) => `[${m.direction}] ${m.body}`)
    .join("\n");

  return ai.complete({
    system:
      "Draft a helpful reply for a support agent. Do not send automatically. Be concise and professional.",
    messages: [
      {
        role: "user",
        content: `FAQ:\n${faq || "none"}\n\nSimilar resolved:\n${examples || "none"}\n\nThread:\n${thread}`,
      },
    ],
  });
}
