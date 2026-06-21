export type ChatWidgetInitMessage = {
  type: "init";
  widgetKey: string;
  sessionToken?: string;
  name?: string;
  email?: string;
  skipAnonymous?: boolean;
};

export type ChatWidgetClientMessage =
  | ChatWidgetInitMessage
  | { type: "message"; text: string }
  | { type: "typing" };

export type ChatWidgetServerMessage =
  | { type: "session"; sessionToken: string; conversationId: string }
  | { type: "message"; text: string; senderType: "ai_agent" | "internal_user" }
  | { type: "typing"; senderType: "ai_agent" | "internal_user"; name?: string }
  | { type: "handoff"; state: "waiting" | "human" | "ai"; message?: string }
  | { type: "history"; messages: Array<{ body: string; direction: string; senderType: string }> }
  | { type: "error"; code: string; message?: string };

export type ChatBroadcastNeedsHuman = {
  conversationId: string;
  reason: string;
  transferId: string;
};

export type ChatBroadcastHandoffState = {
  state: "waiting" | "human" | "ai";
  agentUserId?: string;
};

export type ChatBroadcastMessage = {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  senderType: "external" | "internal_user" | "ai_agent";
  channel: "web_chat";
  createdAt: string;
};

export type ChatBroadcastTyping = {
  senderType: "external" | "internal_user";
  name?: string;
};

export type HandoffJoinRequest = {
  conversationId: string;
  tenantId: string;
  agentUserId: string;
  agentName?: string;
};

export type AgentMessageRequest = {
  conversationId: string;
  tenantId: string;
  agentUserId: string;
  agentName?: string;
  body: string;
};
