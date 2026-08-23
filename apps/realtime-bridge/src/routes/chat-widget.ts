import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { type TenantId, createDomainService } from "@communication-canoe/database";
import type {
  ChatWidgetClientMessage,
  ChatWidgetInitMessage,
} from "@communication-canoe/shared/realtime";
import type { BridgeConfig } from "../config.js";
import { ChatSession } from "../sessions/chat-session.js";
import { sessionManager } from "../sessions/session-manager.js";

// A visitor can type before the session is usable: we send them
// {type:"session"} as soon as we have a token, but chatSession.start() still
// has to fetch thread history and open the OpenAI Realtime connection, and
// that round trip is long enough that a fast typer's first message lands
// mid-init. Buffer anything that arrives in that window and replay it once
// start() resolves rather than rejecting it - nothing on either side retries.
const MAX_PENDING_MESSAGES = 32;

export function handleChatConnection(ws: WebSocket, config: BridgeConfig) {
  let session: ChatSession | null = null;
  let state: "new" | "initializing" | "ready" | "failed" = "new";
  const pending: string[] = [];
  let draining = false;

  // Drains serially so a message queued during init cannot be overtaken by one
  // that arrives while the queue is still being replayed.
  async function drain() {
    const ready = session;
    if (draining || !ready) return;
    draining = true;
    try {
      while (pending.length) {
        await ready.handleVisitorMessage(pending.shift()!);
      }
    } finally {
      draining = false;
    }
  }

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
        if (state !== "new") return;
        state = "initializing";
        session = await initChatSession(ws, msg, config);
        if (!session) {
          state = "failed";
          pending.length = 0;
          return;
        }
        state = "ready";
        await drain();
        return;
      }

      if (msg.type === "message") {
        if (state === "new" || state === "failed") {
          ws.send(JSON.stringify({ type: "error", code: "not_initialized" }));
          return;
        }
        if (pending.length >= MAX_PENDING_MESSAGES) {
          ws.send(JSON.stringify({ type: "error", code: "too_many_pending" }));
          return;
        }
        pending.push(msg.text);
        await drain();
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
  tenantId: TenantId,
  msg: ChatWidgetInitMessage,
) {
  // Phase 9: web_chat sessions ignore isStale - they're pinned once
  // resumed (Phase 8's resume-follow fix already handles reconnecting to a
  // since-split conversation), so staleness-triggered review isn't wired
  // up for this channel, a deliberately narrow scoping decision.
  if (msg.skipAnonymous || (!msg.email && !msg.name)) {
    const identity = await domain.findOrCreateAnonymousIdentity(tenantId, {
      name: msg.name,
      email: msg.email,
      skipAnonymous: true,
    });
    const { conversation } = await domain.findOrCreateConversation(tenantId, identity.id, {
      channel: "web_chat",
    });
    return { conversationId: conversation.id, identityId: identity.id };
  }

  if (msg.email) {
    const identity = await domain.findOrCreateIdentity(tenantId, {
      name: msg.name,
      email: msg.email,
    });
    const { conversation } = await domain.findOrCreateConversation(tenantId, identity.id, {
      channel: "web_chat",
    });
    return { conversationId: conversation.id, identityId: identity.id };
  }

  const identity = await domain.findOrCreateAnonymousIdentity(tenantId, {
    name: msg.name,
    skipAnonymous: true,
  });
  const { conversation } = await domain.findOrCreateConversation(tenantId, identity.id, {
    channel: "web_chat",
  });
  return { conversationId: conversation.id, identityId: identity.id };
}

export function handleHandoffJoin(body: {
  conversationId: string;
  tenantId: TenantId;
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
