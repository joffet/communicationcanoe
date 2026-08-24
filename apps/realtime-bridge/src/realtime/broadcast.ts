import type { TenantId } from "@communication-canoe/database";
import { dashboardHub } from "./dashboard-hub.js";

/**
 * What a live chat session tells the dashboard.
 *
 * These used to go out over a hosted pub/sub service and are now a walk over
 * an in-process Set, which is why they are synchronous - the send is a
 * `ws.send` per connected agent, and there is nothing to await. Conversation
 * changes that originate outside this process (a merge run from the web app)
 * arrive at the same hub through /internal/broadcast instead.
 *
 * Payloads stay content-free: the dashboard refetches through its own
 * authenticated route, which is the only path that ever carried message text.
 * See the protocol note in @communication-canoe/shared/realtime.
 */
export function broadcastNeedsHuman(tenantId: TenantId, conversationId: string) {
  dashboardHub.emitNeedsHuman(tenantId, conversationId);
}

export function broadcastHandoffState(conversationId: string) {
  dashboardHub.emitConversation(conversationId, "handoff_state");
}

export function broadcastChatMessage(conversationId: string) {
  dashboardHub.emitConversation(conversationId, "message");
}
