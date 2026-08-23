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
  onItemAdded?: (itemId: string) => void;
  onTranscriptDone?: (itemId: string, side: "input" | "output", text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>, callId: string) => void;
  onError?: (error: Error) => void;
};

const REALTIME_MODEL = "gpt-realtime-2.1";

export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null;
  private textBuffer = "";

  constructor(private options: RealtimeClientOptions) {}

  async connect(): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;
    // No OpenAI-Beta header: sending "realtime=v1" selects the retired Beta
    // protocol, which now rejects the connection outright. Its absence is what
    // selects GA, so the rest of this file speaks the GA event vocabulary.
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
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

    // GA accepts only ["text"] or ["audio"] - the Beta protocol's ["audio",
    // "text"] pair is rejected. Audio responses still carry a transcript, via
    // the separate response.output_audio_transcript.* events.
    const session: Record<string, unknown> = {
      type: "realtime",
      output_modalities: this.options.mode === "voice" ? ["audio"] : ["text"],
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
      // GA nests audio config under session.audio and takes formats as objects
      // rather than the flat input_audio_format/output_audio_format strings.
      // "audio/pcmu" is GA's name for g711_ulaw, which is what Twilio streams.
      session.audio = {
        input: {
          format: { type: "audio/pcmu" },
          turn_detection: { type: "server_vad" },
          // Without this the caller's own speech is never transcribed - the
          // model hears it, but conversation.item.input_audio_transcription.*
          // only fires when a transcription model is configured.
          transcription: { model: "gpt-4o-mini-transcribe" },
        },
        output: {
          format: { type: "audio/pcmu" },
          voice: "alloy",
        },
      };
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

    if (type === "response.output_text.delta") {
      const delta = (event.delta as string) ?? "";
      this.textBuffer += delta;
      this.options.onTextDelta?.(delta);
    }

    if (type === "response.output_text.done") {
      const text = (event.text as string) ?? this.textBuffer;
      this.textBuffer = "";
      this.options.onTextDone?.(text);
    }

    if (type === "response.output_audio.delta") {
      this.options.onAudioDelta?.((event.delta as string) ?? "");
    }

    // Item ids arrive in conversation order; the transcripts that fill them do
    // not, because the caller's transcription runs alongside the model's reply
    // and can land after it. Callers that care about order track ids from here.
    if (type === "conversation.item.added") {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.id) this.options.onItemAdded?.(item.id as string);
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      this.options.onTranscriptDone?.(
        event.item_id as string,
        "input",
        (event.transcript as string) ?? "",
      );
    }

    if (type === "response.output_audio_transcript.done") {
      this.options.onTranscriptDone?.(
        event.item_id as string,
        "output",
        (event.transcript as string) ?? "",
      );
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
