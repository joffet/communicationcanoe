import type WebSocket from "ws";
import Twilio from "twilio";
import { createDomainService } from "@communication-canoe/database";
import type { TransferToHumanArgs } from "@communication-canoe/shared/realtime";
import type { BridgeConfig } from "../config.js";
import { OpenAIRealtimeClient } from "../openai/realtime-client.js";
import { sessionManager } from "./session-manager.js";

const VOICE_INSTRUCTIONS = `You are a helpful phone support agent. Keep responses brief.
If the caller needs a human, use transfer_to_human.`;

export class VoiceSession {
  private domain = createDomainService();
  private realtime: OpenAIRealtimeClient | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private tenantId: string | null = null;
  private conversationId: string | null = null;
  // Item ids in the order the conversation produced them, and the line each
  // one resolved to. Two maps rather than one array because a transcript can
  // arrive after the next turn has already started - see onTranscriptDone.
  private transcriptOrder: string[] = [];
  private transcriptLines = new Map<string, string>();

  constructor(
    public ws: WebSocket,
    private config: BridgeConfig,
  ) {}

  async handleTwilioMessage(data: Record<string, unknown>) {
    const event = data.event as string;

    if (event === "start") {
      const start = data.start as Record<string, unknown>;
      this.streamSid = start.streamSid as string;
      this.callSid = start.callSid as string;
      const custom = (start.customParameters as Record<string, string>) ?? {};
      this.tenantId = custom.tenantId ?? null;
      this.conversationId = custom.conversationId ?? null;

      if (this.callSid) sessionManager.registerVoice(this.callSid, this);
      await this.startRealtime();
      return;
    }

    if (event === "media" && this.realtime) {
      const media = data.media as Record<string, unknown>;
      const payload = media.payload as string;
      this.realtime.sendAudioDelta(payload);
    }

    if (event === "stop") {
      await this.finalizeCall();
      this.dispose();
    }
  }

  private async startRealtime() {
    if (!this.config.apiKey) return;

    this.realtime = new OpenAIRealtimeClient({
      apiKey: this.config.apiKey,
      mode: "voice",
      instructions: VOICE_INSTRUCTIONS,
      onAudioDelta: (delta) => {
        if (!this.streamSid) return;
        this.ws.send(
          JSON.stringify({
            event: "media",
            streamSid: this.streamSid,
            media: { payload: delta },
          }),
        );
      },
      onItemAdded: (itemId) => {
        if (!this.transcriptOrder.includes(itemId)) this.transcriptOrder.push(itemId);
      },
      onTranscriptDone: (itemId, side, text) => {
        if (!text.trim()) return;
        if (!this.transcriptOrder.includes(itemId)) this.transcriptOrder.push(itemId);
        this.transcriptLines.set(itemId, `${side === "input" ? "Caller" : "Agent"}: ${text}`);
      },
      onToolCall: (name, args, callId) => {
        void this.handleToolCall(name, args, callId);
      },
    });

    await this.realtime.connect();
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) {
    if (!this.realtime || name !== "transfer_to_human") return;

    const input = args as TransferToHumanArgs;

    const tenantId = this.tenantId;
    // Both of these come from the Twilio <Stream> customParameters and are the
    // only trustworthy source for them. There is deliberately no fallback to a
    // model-supplied id: logLiveTransfer does not check that a conversation
    // belongs to the tenant, so a value the caller could talk the model into
    // saying would log the transfer against someone else's conversation.
    // Refusing the transfer is the safe failure.
    const conversationId = this.conversationId;

    if (!tenantId || !conversationId) {
      this.realtime.submitToolOutput(callId, JSON.stringify({ success: false }));
      return;
    }

    const onCall = await this.domain.getOnCallUsers(tenantId);
    const target = onCall[0];

    if (!target?.phoneNumber) {
      await this.domain.logLiveTransfer({
        tenantId,
        conversationId,
        channel: "voice",
        outcome: "no_answer",
        reason: input.reason,
      });
      this.realtime.submitToolOutput(
        callId,
        JSON.stringify({ success: false, reason: "no_agents" }),
      );
      return;
    }

    const transfer = await this.domain.logLiveTransfer({
      tenantId,
      conversationId,
      channel: "voice",
      attemptedUserId: target.id,
      outcome: "answered",
      reason: input.reason,
    });

    if (
      this.config.twilioAccountSid &&
      this.config.twilioAuthToken &&
      this.callSid
    ) {
      const client = Twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
      await client.calls(this.callSid).update({
        twiml: `<Response><Say>Connecting you now.</Say><Dial timeout="30" action="${this.config.appUrl}/api/webhooks/twilio/dial-status">${target.phoneNumber}</Dial></Response>`,
      });
    }

    void transfer;
    this.realtime.submitToolOutput(callId, JSON.stringify({ success: true }));
  }

  private async finalizeCall() {
    const body = this.transcriptOrder
      .map((id) => this.transcriptLines.get(id))
      .filter((line): line is string => Boolean(line))
      .join("\n");

    if (!this.tenantId || !this.conversationId || !body) return;

    await this.domain.appendMessage({
      tenantId: this.tenantId,
      conversationId: this.conversationId,
      channel: "voice",
      direction: "inbound",
      senderType: "external",
      body,
      transcript: body,
      // A real live call transcript with the customer.
      visibility: "external",
    });
  }

  dispose() {
    this.realtime?.close();
    if (this.callSid) sessionManager.unregisterVoice(this.callSid);
  }
}
