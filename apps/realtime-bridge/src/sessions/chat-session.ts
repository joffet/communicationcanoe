import WebSocket from "ws";
import { createDomainService } from "@communication-canoe/database";
import type {
  CaptureContactInfoArgs,
  TransferToHumanArgs,
} from "@communication-canoe/shared/realtime";
import type { ChatWidgetServerMessage } from "@communication-canoe/shared/realtime";
import type { BridgeConfig } from "../config.js";
import { OpenAIRealtimeClient } from "../openai/realtime-client.js";
import {
  broadcastChatMessage,
  broadcastHandoffState,
  broadcastNeedsHuman,
} from "../realtime/broadcast.js";
import { sessionManager } from "./session-manager.js";
import { handleChatTransfer } from "../handoff/chat-handoff.js";

const DEFAULT_INSTRUCTIONS = `You are a helpful customer support assistant for a business.
Be concise and friendly. If the visitor wants a human, use transfer_to_human.
If they share contact details, use capture_contact_info.`;

export class ChatSession {
  private domain = createDomainService();
  private realtime: OpenAIRealtimeClient | null = null;
  private handoffState: "ai" | "waiting" | "human" = "ai";
  private agentUserId: string | null = null;
  private agentName: string | null = null;
  private pendingAiText = "";
  private activeTransferId: string | null = null;
  private handoffTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public ws: WebSocket,
    public tenantId: string,
    public conversationId: string,
    public identityId: string,
    public sessionToken: string,
    private config: BridgeConfig,
  ) {}

  async start() {
    sessionManager.registerChat(this);

    if (!this.config.apiKey) {
      this.send({ type: "error", code: "missing_api_key", message: "OpenAI not configured" });
      return;
    }

    const thread = await this.domain.getConversationThread(this.conversationId);
    if (thread?.messages.length) {
      this.send({
        type: "history",
        messages: thread.messages.map((m) => ({
          body: m.body,
          direction: m.direction,
          senderType: m.sender_type,
        })),
      });
    }

    this.realtime = new OpenAIRealtimeClient({
      apiKey: this.config.apiKey,
      mode: "text",
      instructions: DEFAULT_INSTRUCTIONS,
      onTextDelta: (delta) => {
        this.pendingAiText += delta;
      },
      onTextDone: async (text) => {
        const body = text || this.pendingAiText;
        this.pendingAiText = "";
        if (!body.trim() || this.handoffState !== "ai") return;

        const message = await this.domain.appendMessage({
          tenantId: this.tenantId,
          conversationId: this.conversationId,
          channel: "web_chat",
          direction: "outbound",
          senderType: "ai_agent",
          body,
        });

        this.send({ type: "message", text: body, senderType: "ai_agent" });
        await broadcastChatMessage(this.conversationId, {
          id: message.id,
          body: message.body,
          direction: message.direction,
          senderType: message.sender_type,
          channel: "web_chat",
          createdAt: message.created_at,
        });
      },
      onToolCall: (name, args, callId) => {
        void this.handleToolCall(name, args, callId);
      },
      onError: (err) => {
        console.error("[chat-session] Realtime error:", err.message);
      },
    });

    await this.realtime.connect();
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) {
    if (!this.realtime) return;

    if (name === "capture_contact_info") {
      const input = args as CaptureContactInfoArgs;
      try {
        await this.domain.convertIdentity(
          this.identityId,
          this.tenantId,
          {
            name: input.name,
            email: input.email,
            phone: input.phone,
          },
          "system",
        );
        this.realtime.submitToolOutput(callId, JSON.stringify({ success: true }));
      } catch (err) {
        this.realtime.submitToolOutput(
          callId,
          JSON.stringify({ success: false, error: String(err) }),
        );
      }
      return;
    }

    if (name === "transfer_to_human") {
      const input = args as TransferToHumanArgs;
      await handleChatTransfer(this, input.reason);
      this.realtime.submitToolOutput(callId, JSON.stringify({ success: true }));
    }
  }

  async handleVisitorMessage(text: string) {
    if (this.handoffState === "human") {
      const message = await this.domain.appendMessage({
        tenantId: this.tenantId,
        conversationId: this.conversationId,
        channel: "web_chat",
        direction: "inbound",
        senderType: "external",
        senderId: this.identityId,
        body: text,
      });
      await broadcastChatMessage(this.conversationId, {
        id: message.id,
        body: message.body,
        direction: message.direction,
        senderType: message.sender_type,
        channel: "web_chat",
        createdAt: message.created_at,
      });
      return;
    }

    if (this.handoffState === "waiting") {
      this.send({
        type: "message",
        text: "Please hold — we're connecting you with a team member.",
        senderType: "ai_agent",
      });
      return;
    }

    await this.domain.appendMessage({
      tenantId: this.tenantId,
      conversationId: this.conversationId,
      channel: "web_chat",
      direction: "inbound",
      senderType: "external",
      senderId: this.identityId,
      body: text,
    });

    this.realtime?.sendUserText(text);
  }

  async beginHandoff(reason: string) {
    this.handoffState = "waiting";
    this.realtime?.close();
    this.realtime = null;

    const transfer = await this.domain.logLiveTransfer({
      tenantId: this.tenantId,
      conversationId: this.conversationId,
      channel: "web_chat",
      outcome: "pending",
    });
    this.activeTransferId = transfer.id;

    await broadcastNeedsHuman(this.tenantId, {
      conversationId: this.conversationId,
      reason,
      transferId: transfer.id,
    });

    this.send({
      type: "handoff",
      state: "waiting",
      message: "Connecting you to a team member…",
    });
    await broadcastHandoffState(this.conversationId, { state: "waiting" });

    this.handoffTimer = setTimeout(() => {
      void this.handleHandoffTimeout();
    }, this.config.handoffTimeoutMs);
  }

  async agentJoin(agentUserId: string, agentName?: string) {
    if (this.handoffTimer) {
      clearTimeout(this.handoffTimer);
      this.handoffTimer = null;
    }

    this.handoffState = "human";
    this.agentUserId = agentUserId;
    this.agentName = agentName ?? null;

    await this.domain.assignConversationUser(this.conversationId, agentUserId);

    if (this.activeTransferId) {
      await this.domain.updateLiveTransferOutcome(
        this.activeTransferId,
        "answered",
        agentUserId,
      );
    }

    this.send({
      type: "handoff",
      state: "human",
      message: `${agentName ?? "A team member"} has joined the chat.`,
    });
    await broadcastHandoffState(this.conversationId, {
      state: "human",
      agentUserId,
    });
  }

  relayAgentMessage(body: string) {
    this.send({
      type: "message",
      text: body,
      senderType: "internal_user",
    });
  }

  async agentMessage(body: string, agentUserId: string, agentName?: string) {
    const message = await this.domain.appendMessage({
      tenantId: this.tenantId,
      conversationId: this.conversationId,
      channel: "web_chat",
      direction: "outbound",
      senderType: "internal_user",
      senderId: agentUserId,
      body,
    });

    this.send({
      type: "message",
      text: body,
      senderType: "internal_user",
    });

    await broadcastChatMessage(this.conversationId, {
      id: message.id,
      body: message.body,
      direction: message.direction,
      senderType: message.sender_type,
      channel: "web_chat",
      createdAt: message.created_at,
    });
    void agentName;
  }

  private async handleHandoffTimeout() {
    if (this.handoffState !== "waiting") return;

    if (this.activeTransferId) {
      await this.domain.updateLiveTransferOutcome(this.activeTransferId, "no_answer");
    }

    this.handoffState = "ai";
    this.send({
      type: "handoff",
      state: "ai",
      message: "No one is available right now. I can help you leave a message.",
    });
    await broadcastHandoffState(this.conversationId, { state: "ai" });

    await this.start();
    this.realtime?.sendUserText(
      "The visitor waited for a human but no agent joined. Apologize and offer to take a message or continue helping.",
    );
  }

  send(msg: ChatWidgetServerMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  dispose() {
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    this.realtime?.close();
    sessionManager.unregisterChat(this.conversationId);
  }
}
