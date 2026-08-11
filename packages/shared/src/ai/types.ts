export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionRequest {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export interface AiProvider {
  complete(request: AiCompletionRequest): Promise<string>;
}

export interface RouteConversationInput {
  teams: Array<{ id: string; name: string }>;
  messagePreview: string;
}

export interface RouteConversationResult {
  teamId: string | null;
  reasoning: string;
}

export interface SummarizeConversationInput {
  messages: Array<{ channel: string; direction: string; body: string; createdAt: string }>;
}

export interface SuggestReplyInput {
  conversationMessages: Array<{ direction: string; body: string }>;
  resolvedExamples: Array<{ summary: string | null; sampleReply: string }>;
  faqSnippets: Array<{ q: string; a: string }>;
  // Phase 10: top-K chunks from the tenant's uploaded knowledge documents,
  // retrieved via similarity search against the latest inbound message.
  // Optional and additive - existing callers (comm-canoe's own dashboard
  // suggest-reply route) keep working unchanged without it.
  retrievedChunks?: Array<{ heading: string | null; content: string }>;
}

export interface ReviewMessageToneInput {
  body: string;
  recentMessages: Array<{ direction: string; body: string }>;
}

export interface ReviewMessageToneResult {
  status: "approved" | "flagged";
  reasoning: string;
}

export interface ClassifyTopicShiftInput {
  newMessageBody: string;
  priorMessages: Array<{ direction: string; body: string }>;
}

export interface ClassifyTopicShiftResult {
  isNewTopic: boolean;
  reasoning: string;
}

// Deliberately a separate interface from AiProvider, not an optional `embed()`
// method on it - Anthropic has no first-party embeddings endpoint, and which
// model drafts text vs. which model embeds are independent choices. See
// createEmbeddingProvider() in embedding-provider.ts.
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}
