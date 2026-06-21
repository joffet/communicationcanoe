import type WebSocket from "ws";
import type { BridgeConfig } from "../config.js";
import { VoiceSession } from "../sessions/voice-session.js";

export function handleTwilioStreamConnection(ws: WebSocket, config: BridgeConfig) {
  const session = new VoiceSession(ws, config);

  ws.on("message", (raw) => {
    void (async () => {
      try {
        const data = JSON.parse(raw.toString()) as Record<string, unknown>;
        await session.handleTwilioMessage(data);
      } catch (err) {
        console.error("[twilio-stream] message error:", err);
      }
    })();
  });

  ws.on("close", () => {
    session.dispose();
  });
}
