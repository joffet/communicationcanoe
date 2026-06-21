import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { createDomainService } from "@communication-canoe/database";
import type {
  ChatWidgetClientMessage,
  ChatWidgetInitMessage,
} from "@communication-canoe/shared/realtime";
import type { BridgeConfig } from "../config.js";
import { ChatSession } from "../sessions/chat-session.js";
import { sessionManager } from "../sessions/session-manager.js";

export function handleChatConnection(ws: WebSocket, config: BridgeConfig) {
  let session: ChatSession | null = null;
  let initialized = false;

  ws.on("message", (raw) => {
    void (async () => {
      let msg: ChatWidgetClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ChatWidgetClientMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "invalid_json" }));
        return;
      }

      if (msg.type === "init") {
        if (initialized) return;
        initialized = true;
        session = await initChatSession(ws, msg, config);
        return;
      }

      if (!session) {
        ws.send(JSON.stringify({ type: "error", code: "not_initialized" }));
        return;
      }

      if (msg.type === "message") {
        await session.handleVisitorMessage(msg.text);
      }
    })();
  });

  ws.on("close", () => {
    session?.dispose();
  });
}

async function initChatSession(
  ws: WebSocket,
  msg: ChatWidgetInitMessage,
  config: BridgeConfig,
): Promise<ChatSession | null> {
  const domain = createDomainService();
  const tenant = await domain.resolveTenantByWidgetKey(msg.widgetKey);

  if (!tenant) {
    ws.send(JSON.stringify({ type: "error", code: "invalid_widget_key" }));
    ws.close();
    return null;
  }

  let conversationId: string;
  let identityId: string;

  if (msg.sessionToken) {
    const resumed = await domain.resumeConversationBySessionToken(
      tenant.id,
      msg.sessionToken,
    );
    if (resumed) {
      conversationId = resumed.conversation.id;
      identityId = resumed.identity.id;
    } else {
      ws.send(JSON.stringify({ type: "error", code: "invalid_session" }));
      const created = await createNewSession(domain, tenant.id, msg);
      conversationId = created.conversationId;
      identityId = created.identityId;
    }
  } else {
    const created = await createNewSession(domain, tenant.id, msg);
    conversationId = created.conversationId;
    identityId = created.identityId;
  }

  const sessionToken = domain.createChatSessionToken(
    tenant.id,
    conversationId,
    identityId,
  );

  ws.send(
    JSON.stringify({
      type: "session",
      sessionToken,
      conversationId,
    }),
  );

  const chatSession = new ChatSession(
    ws,
    tenant.id,
    conversationId,
    identityId,
    sessionToken,
    config,
  );

  await chatSession.start();
  return chatSession;
}

async function createNewSession(
  domain: ReturnType<typeof createDomainService>,
  tenantId: string,
  msg: ChatWidgetInitMessage,
) {
  if (msg.skipAnonymous || (!msg.email && !msg.name)) {
    const identity = await domain.findOrCreateAnonymousIdentity(tenantId, {
      name: msg.name,
      email: msg.email,
      skipAnonymous: true,
    });
    const conversation = await domain.findOrCreateConversation(tenantId, identity.id);
    return { conversationId: conversation.id, identityId: identity.id };
  }

  if (msg.email) {
    const identity = await domain.findOrCreateIdentity(tenantId, {
      name: msg.name,
      email: msg.email,
    });
    const conversation = await domain.findOrCreateConversation(tenantId, identity.id);
    return { conversationId: conversation.id, identityId: identity.id };
  }

  const identity = await domain.findOrCreateAnonymousIdentity(tenantId, {
    name: msg.name,
    skipAnonymous: true,
  });
  const conversation = await domain.findOrCreateConversation(tenantId, identity.id);
  return { conversationId: conversation.id, identityId: identity.id };
}

export function handleHandoffJoin(body: {
  conversationId: string;
  tenantId: string;
  agentUserId: string;
  agentName?: string;
}) {
  const session = sessionManager.getChat(body.conversationId);
  if (!session) return false;
  void session.agentJoin(body.agentUserId, body.agentName);
  return true;
}

export function handleAgentMessage(body: {
  conversationId: string;
  agentUserId: string;
  agentName?: string;
  body: string;
  relayOnly?: boolean;
}) {
  const session = sessionManager.getChat(body.conversationId);
  if (!session) return false;
  if (body.relayOnly) {
    session.relayAgentMessage(body.body);
  } else {
    void session.agentMessage(body.body, body.agentUserId, body.agentName);
  }
  return true;
}
