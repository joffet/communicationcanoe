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
  private transcriptLines: string[] = [];

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
    const conversationId = this.conversationId ?? input.conversation_id;

    if (!tenantId || !conversationId) {
      this.realtime.submitToolOutput(callId, JSON.stringify({ success: false }));
      return;
    }

    const onCall = await this.domain.getOnCallUsers(tenantId);
    const target = onCall[0];

    if (!target?.phone_number) {
      await this.domain.logLiveTransfer({
        tenantId,
        conversationId,
        channel: "voice",
        outcome: "no_answer",
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
    });

    if (
      this.config.twilioAccountSid &&
      this.config.twilioAuthToken &&
      this.callSid
    ) {
      const client = Twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
      await client.calls(this.callSid).update({
        twiml: `<Response><Say>Connecting you now.</Say><Dial timeout="30" action="${this.config.appUrl}/api/webhooks/twilio/dial-status">${target.phone_number}</Dial></Response>`,
      });
    }

    void transfer;
    this.realtime.submitToolOutput(callId, JSON.stringify({ success: true }));
  }

  private async finalizeCall() {
    if (!this.tenantId || !this.conversationId || !this.transcriptLines.length) return;

    const body = this.transcriptLines.join("\n");
    await this.domain.appendMessage({
      tenantId: this.tenantId,
      conversationId: this.conversationId,
      channel: "voice",
      direction: "inbound",
      senderType: "external",
      body,
      transcript: body,
    });
  }

  dispose() {
    this.realtime?.close();
    if (this.callSid) sessionManager.unregisterVoice(this.callSid);
  }
}
