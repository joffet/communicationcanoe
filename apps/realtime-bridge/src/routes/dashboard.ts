import type { RawData } from "ws";
import type WebSocket from "ws";
import { createDomainService, verifyDashboardToken } from "@communication-canoe/database";
import type {
  DashboardClientMessage,
  DashboardServerMessage,
} from "@communication-canoe/shared/realtime";
import { dashboardHub, type DashboardClient } from "../realtime/dashboard-hub.js";

/**
 * A dashboard socket, from the bridge's side.
 *
 * Nothing is registered until an `auth` frame verifies: an unauthenticated
 * socket is in the hub's index of nobody, so no fan-out can reach it. The
 * token names the tenant, which is what every later frame is checked against -
 * the client never gets to assert its own identity or scope.
 */
export function handleDashboardConnection(ws: WebSocket) {
  let client: DashboardClient | null = null;

  function send(msg: DashboardServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  async function handleMessage(raw: RawData) {
    let msg: DashboardClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as DashboardClientMessage;
    } catch {
      send({ type: "error", code: "invalid_json" });
      return;
    }

    if (msg.type === "auth") {
      if (client) return;

      const payload = verifyDashboardToken(msg.token);
      if (!payload) {
        send({ type: "error", code: "invalid_token" });
        ws.close();
        return;
      }

      client = {
        tenantId: payload.tenantId,
        userId: payload.userId,
        name: payload.name,
        watching: null,
        send,
      };
      dashboardHub.add(client);
      send({ type: "ready" });
      return;
    }

    if (msg.type === "watch") {
      const authed = client;
      if (!authed) {
        send({ type: "error", code: "not_authenticated" });
        return;
      }

      if (msg.conversationId === null) {
        dashboardHub.watch(authed, null);
        return;
      }

      // The one authorization check on this socket, deliberately placed here:
      // pass it and the conversation is this tenant's, which is what lets
      // every later fan-out address a bare conversation id.
      const allowed = await conversationBelongsToTenant(
        msg.conversationId,
        authed.tenantId,
      );
      if (!allowed) {
        send({ type: "error", code: "forbidden" });
        return;
      }

      dashboardHub.watch(authed, msg.conversationId);
    }
  }

  ws.on("message", (raw) => {
    // Nothing above is allowed to reject into the void: an unhandled rejection
    // in a socket handler takes down the whole bridge, and with it every live
    // call and chat this process is holding.
    void handleMessage(raw).catch((err: unknown) => {
      console.error(
        "[dashboard] frame failed:",
        err instanceof Error ? err.message : err,
      );
      send({ type: "error", code: "internal_error" });
    });
  });

  ws.on("close", () => {
    if (client) dashboardHub.remove(client);
  });
}

async function conversationBelongsToTenant(
  conversationId: string,
  tenantId: string,
): Promise<boolean> {
  const thread = await createDomainService().getConversationThread(conversationId);
  return thread?.tenantId === tenantId;
}
