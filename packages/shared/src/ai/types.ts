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
}
