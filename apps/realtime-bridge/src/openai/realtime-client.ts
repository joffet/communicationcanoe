import WebSocket from "ws";
import type { RealtimeMode } from "@communication-canoe/shared/realtime";
import { getToolsForMode } from "@communication-canoe/shared/realtime";

export type RealtimeClientOptions = {
  apiKey: string;
  mode: RealtimeMode;
  instructions: string;
  onTextDelta?: (delta: string) => void;
  onTextDone?: (text: string) => void;
  onAudioDelta?: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>, callId: string) => void;
  onError?: (error: Error) => void;
};

const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null;
  private textBuffer = "";

  constructor(private options: RealtimeClientOptions) {}

  async connect(): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });

    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("error", (err) =>
      this.options.onError?.(err instanceof Error ? err : new Error(String(err))),
    );

    const modalities = this.options.mode === "voice" ? ["audio", "text"] : ["text"];
    const session: Record<string, unknown> = {
      modalities,
      instructions: this.options.instructions,
      tools: getToolsForMode(this.options.mode).map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      tool_choice: "auto",
    };

    if (this.options.mode === "voice") {
      session.input_audio_format = "g711_ulaw";
      session.output_audio_format = "g711_ulaw";
      session.voice = "alloy";
      session.turn_detection = { type: "server_vad" };
    }

    this.send({ type: "session.update", session });
  }

  sendUserText(text: string) {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
  }

  sendAudioDelta(payload: string) {
    this.send({ type: "input_audio_buffer.append", audio: payload });
  }

  submitToolOutput(callId: string, output: string) {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    });
    this.send({ type: "response.create" });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  private send(event: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  private handleMessage(raw: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = event.type as string;

    if (type === "response.text.delta") {
      const delta = (event.delta as string) ?? "";
      this.textBuffer += delta;
      this.options.onTextDelta?.(delta);
    }

    if (type === "response.text.done") {
      const text = (event.text as string) ?? this.textBuffer;
      this.textBuffer = "";
      this.options.onTextDone?.(text);
    }

    if (type === "response.audio.delta") {
      this.options.onAudioDelta?.((event.delta as string) ?? "");
    }

    if (type === "response.output_item.done") {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call") {
        const name = item.name as string;
        const callId = item.call_id as string;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse((item.arguments as string) ?? "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        this.options.onToolCall?.(name, args, callId);
      }
    }

    if (type === "error") {
      const err = event.error as Record<string, unknown> | undefined;
      this.options.onError?.(new Error(String(err?.message ?? "Realtime API error")));
    }
  }
}
