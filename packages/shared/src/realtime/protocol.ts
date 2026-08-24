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
 * Dashboard socket protocol.
 *
 * The dashboard opens one authenticated WebSocket to the realtime bridge
 * (`/dashboard`) and does three things over it: hears about tenant-wide
 * escalations, hears that the conversation it currently has open changed, and
 * announces itself as a viewer of that conversation. Presence and change
 * notification share the socket because they share a subject - the client
 * sends one `watch` naming the open conversation, and both follow from it.
 *
 * The socket is authenticated before it carries anything: the client's first
 * frame is `auth` with a short-lived token minted by the web app from the
 * caller's Better Auth session (`/api/realtime/token`), and the bridge scopes
 * everything after it to the tenant in that token. That is what lets `viewers`
 * carry agent names - the identity comes from the token, not from the client,
 * and only members of the tenant ever see it.
 *
 * Change notifications stay content-free anyway, for a different reason than
 * the old public-channel rule: the dashboard never read the content. Every
 * `conversation` frame lands in a `router.refresh()`, and the conversation is
 * refetched through the authenticated, tenant-scoped server route, which is
 * the only path that was ever load-bearing. The visitor's own copy of a
 * message does not come from here either - chat-session.ts sends it down
 * their WebSocket directly.
 */
export type DashboardClientMessage =
  /** Always the first frame; anything before it is refused. */
  | { type: "auth"; token: string }
  /** The conversation this client has open, or null when none is. */
  | { type: "watch"; conversationId: string | null };

export type DashboardViewer = { userId: string; name: string };

/** What changed about a conversation. `updated` is the structural one -
 * emitted by DomainService.splitConversation/mergeConversations for a
 * conversation of any channel, where `message` is web_chat-shaped and comes
 * from the live chat session. */
export type DashboardConversationEvent = "message" | "handoff_state" | "updated";

export type DashboardServerMessage =
  | { type: "ready" }
  | { type: "needs_human"; conversationId: string }
  | {
      type: "conversation";
      conversationId: string;
      event: DashboardConversationEvent;
    }
  /** Everyone watching `conversationId` except the recipient, deduped by
   * user, re-sent to every watcher whenever the set changes. */
  | { type: "viewers"; conversationId: string; viewers: DashboardViewer[] }
  | { type: "error"; code: string };

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
