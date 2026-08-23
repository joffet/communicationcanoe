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

/**
 * Dashboard broadcast payloads.
 *
 * These go out on Supabase Realtime channels that any holder of the public
 * anon key can subscribe to - they are not private channels, and the
 * authorization data that would gate them (conversations, memberships) lives
 * in PlanetScale where a Supabase RLS policy cannot reach it. So the rule
 * here is that a payload carries an identifier or nothing, never content:
 * whatever a subscriber learns must be no more than "something happened".
 *
 * That costs nothing, because the dashboard never read the content anyway.
 * Every listener in chat-realtime.tsx calls router.refresh() and drops the
 * payload on the floor; the conversation is then refetched through the
 * authenticated, tenant-scoped server route, which is the only path that was
 * ever load-bearing. The visitor's own copy of a message does not come from
 * here either - chat-session.ts sends it down their WebSocket directly.
 */
export type ChatBroadcastNeedsHuman = {
  /** The only field any subscriber reads (useNeedsHumanConversations). */
  conversationId: string;
};

/** Signal only - see the note above. `handoff_state` names what changed. */
export type ChatBroadcastHandoffState = Record<string, never>;

/** Signal only - see the note above. `message` names what changed. */
export type ChatBroadcastMessage = Record<string, never>;

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
