import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeConfig } from "../config.js";
import type { TenantId } from "@communication-canoe/database";

/** A real uuid: VoiceSession shape-checks the tenant id Twilio replays, so a
 * bare "tenant-1" placeholder would be rejected at that boundary and these
 * tests would exercise the tenantless path instead of the one they name. */
const TENANT_ID = "11111111-1111-4111-8111-111111111111" as TenantId;

const appendMessage = vi.fn();

// Spreads the real brand helpers in rather than restating them, so the shape
// check VoiceSession applies here is the one production applies.
vi.mock("@communication-canoe/database", async () => ({
  ...(await import("@communication-canoe/shared/brands")),
  createDomainService: () => ({
    appendMessage,
    logLiveTransfer: vi.fn(),
    getOnCallUsers: vi.fn(async () => []),
  }),
}));

/** The options the session handed the realtime client, so a test can fire the
 * transcript callbacks the way the GA transcript events would. */
let clientOptions: {
  onItemAdded?: (itemId: string) => void;
  onTranscriptDone?: (itemId: string, side: "input" | "output", text: string) => void;
};

vi.mock("../openai/realtime-client.js", () => ({
  OpenAIRealtimeClient: class {
    constructor(options: typeof clientOptions) {
      clientOptions = options;
    }
    connect = vi.fn(async () => {});
    close = vi.fn();
    sendAudioDelta = vi.fn();
    submitToolOutput = vi.fn();
  },
}));

const { VoiceSession } = await import("./voice-session.js");

const config = { apiKey: "test-key", appUrl: "http://localhost:3000" } as BridgeConfig;
const fakeWs = () => ({ send: vi.fn(), readyState: 1 }) as never;

async function startedSession() {
  const session = new VoiceSession(fakeWs(), config);
  await session.handleTwilioMessage({
    event: "start",
    start: {
      streamSid: "MZ1",
      callSid: "CA1",
      customParameters: { tenantId: TENANT_ID, conversationId: "conv-1" },
    },
  });
  return session;
}

const hangUp = (s: Awaited<ReturnType<typeof startedSession>>) =>
  s.handleTwilioMessage({ event: "stop" });

beforeEach(() => {
  appendMessage.mockClear();
});

describe("voice call transcripts", () => {
  it("persists both sides of the call, labelled", async () => {
    const session = await startedSession();

    clientOptions.onItemAdded?.("item-1");
    clientOptions.onTranscriptDone?.("item-1", "input", "I need a refund");
    clientOptions.onItemAdded?.("item-2");
    clientOptions.onTranscriptDone?.("item-2", "output", "I can help with that");

    await hangUp(session);

    expect(appendMessage).toHaveBeenCalledTimes(1);
    const written = appendMessage.mock.calls[0][0];
    expect(written.body).toBe("Caller: I need a refund\nAgent: I can help with that");
    expect(written.transcript).toBe(written.body);
    expect(written.channel).toBe("voice");
  });

  it("keeps conversation order when a transcript resolves late", async () => {
    const session = await startedSession();

    // The caller's transcription runs alongside the model's reply, so the
    // agent's line can land first even though the caller spoke first.
    clientOptions.onItemAdded?.("item-1");
    clientOptions.onItemAdded?.("item-2");
    clientOptions.onTranscriptDone?.("item-2", "output", "I can help with that");
    clientOptions.onTranscriptDone?.("item-1", "input", "I need a refund");

    await hangUp(session);

    expect(appendMessage.mock.calls[0][0].body).toBe(
      "Caller: I need a refund\nAgent: I can help with that",
    );
  });

  it("writes nothing when the call produced no transcript", async () => {
    const session = await startedSession();
    await hangUp(session);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("skips empty transcripts rather than emitting a bare label", async () => {
    const session = await startedSession();

    clientOptions.onItemAdded?.("item-1");
    clientOptions.onTranscriptDone?.("item-1", "input", "   ");
    clientOptions.onItemAdded?.("item-2");
    clientOptions.onTranscriptDone?.("item-2", "output", "Hello?");

    await hangUp(session);

    expect(appendMessage.mock.calls[0][0].body).toBe("Agent: Hello?");
  });
});
