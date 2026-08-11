import { createAiProvider } from "./provider";
import type {
  ClassifyTopicShiftInput,
  ClassifyTopicShiftResult,
  ReviewMessageToneInput,
  ReviewMessageToneResult,
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
  // Phase 10: chunks retrieved via similarity search from the tenant's
  // uploaded knowledge documents. Included as its own section, separate from
  // FAQ/resolved-examples, so the model can distinguish "official document
  // text" from "a past agent's phrasing."
  const knowledge = (input.retrievedChunks ?? [])
    .map((c) => (c.heading ? `[${c.heading}] ${c.content}` : c.content))
    .join("\n\n");

  return ai.complete({
    system:
      "Draft a helpful reply for a support agent. Do not send automatically. Be concise and professional. " +
      "Ground your answer in the provided knowledge base excerpts when they're relevant.",
    messages: [
      {
        role: "user",
        content: `Knowledge base:\n${knowledge || "none"}\n\nFAQ:\n${faq || "none"}\n\nSimilar resolved:\n${examples || "none"}\n\nThread:\n${thread}`,
      },
    ],
  });
}

/**
 * Reviews an admin-composed outbound message before it's allowed to reach a
 * resident (gates Phase 3's scheduled-message-worker via
 * messages.ai_review_status). A holistic judgment call on the text alone -
 * flags angry/emotional tone or content that reads like it wasn't meant for
 * the resident (internal shorthand, a comment addressed to a colleague) -
 * not a structural check against conversation participants (nothing
 * populates that table from any live code path yet). Defaults to 'flagged'
 * on any parse failure or unrecognized status - the conservative failure
 * mode for anything gating a send to a real resident, unlike
 * routeConversation's fall-back-to-first-team default.
 */
export async function reviewMessageTone(
  input: ReviewMessageToneInput,
): Promise<ReviewMessageToneResult> {
  const ai = createAiProvider();
  const thread = input.recentMessages.map((m) => `[${m.direction}] ${m.body}`).join("\n");

  const raw = await ai.complete({
    system:
      'You review a support agent\'s draft reply before it is sent to a customer. Flag angry or emotional tone, and any content that reads like it was meant for a colleague rather than the customer (internal shorthand, a comment addressed to someone else). Reply with JSON only: {"status":"approved"|"flagged","reasoning":"short explanation"}.',
    messages: [
      {
        role: "user",
        content: `Recent thread:\n${thread || "none"}\n\nDraft reply to review:\n${input.body}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(raw) as Partial<ReviewMessageToneResult>;
    if (parsed.status === "approved" || parsed.status === "flagged") {
      return { status: parsed.status, reasoning: parsed.reasoning ?? raw };
    }
    return { status: "flagged", reasoning: raw || "Unrecognized review response" };
  } catch {
    return { status: "flagged", reasoning: raw || "Failed to parse review response" };
  }
}

/**
 * Phase 9: judges whether a message that landed in a conversation which had
 * gone quiet (past the tenant's staleness threshold) represents a genuinely
 * different topic/issue, or is a continuation. Not routeConversation (team
 * classification) or reviewMessageTone (send-gating) - a distinct concern,
 * deliberately named to avoid colliding with either. Defaults to
 * `isNewTopic: false` on any parse failure or unrecognized response - the
 * conservative direction here is to *not* split (a resident's own message
 * gets deliberately fragmented on a false positive with no easy undo for
 * the resident-facing side, whereas staying together just means an admin
 * might see two topics in one thread, no worse than today). The opposite
 * conservative direction from reviewMessageTone, which defaults toward
 * blocking a send.
 */
export async function classifyTopicShift(
  input: ClassifyTopicShiftInput,
): Promise<ClassifyTopicShiftResult> {
  const ai = createAiProvider();
  const thread = input.priorMessages.map((m) => `[${m.direction}] ${m.body}`).join("\n");

  const raw = await ai.complete({
    system:
      'You review a new message in an ongoing support conversation that has been quiet for a while. Decide whether it continues the existing topic, or starts a clearly different one. Default to "continues" unless the new message is obviously unrelated. Reply with JSON only: {"isNewTopic":true|false,"reasoning":"short explanation"}.',
    messages: [
      {
        role: "user",
        content: `Existing conversation (may be old):\n${thread || "none"}\n\nNew message:\n${input.newMessageBody}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(raw) as Partial<ClassifyTopicShiftResult>;
    if (typeof parsed.isNewTopic === "boolean") {
      return { isNewTopic: parsed.isNewTopic, reasoning: parsed.reasoning ?? raw };
    }
    return { isNewTopic: false, reasoning: raw || "Unrecognized classification response" };
  } catch {
    return { isNewTopic: false, reasoning: raw || "Failed to parse classification response" };
  }
}
