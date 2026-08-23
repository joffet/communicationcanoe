import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRANSFER_TO_HUMAN_TOOL } from "@communication-canoe/shared/realtime";
import type { BridgeConfig } from "../config.js";

const logLiveTransfer = vi.fn();
const getOnCallUsers = vi.fn();

vi.mock("@communication-canoe/database", () => ({
  createDomainService: () => ({
    logLiveTransfer,
    getOnCallUsers,
    getConversationThread: vi.fn(async () => null),
    updateLiveTransferOutcome: vi.fn(),
    assignConversationUser: vi.fn(),
    appendMessage: vi.fn(),
    convertIdentity: vi.fn(),
  }),
}));

vi.mock("../realtime/broadcast.js", () => ({
  broadcastNeedsHuman: vi.fn(),
  broadcastHandoffState: vi.fn(),
  broadcastChatMessage: vi.fn(),
}));

const submitToolOutput = vi.fn();

/** The options the session under test handed the realtime client, so a test
 * can fire onToolCall the way a model's tool call would. */
let clientOptions: { onToolCall?: (n: string, a: Record<string, unknown>, id: string) => void };

vi.mock("../openai/realtime-client.js", () => ({
  OpenAIRealtimeClient: class {
    constructor(options: typeof clientOptions) {
      clientOptions = options;
    }
    connect = vi.fn(async () => {});
    close = vi.fn();
    sendUserText = vi.fn();
    sendAudioDelta = vi.fn();
    submitToolOutput = submitToolOutput;
  },
}));

const { VoiceSession } = await import("./voice-session.js");
const { ChatSession } = await import("./chat-session.js");

const config = {
  apiKey: "test-key",
  handoffTimeoutMs: 90_000,
  appUrl: "http://localhost:3000",
  twilioAccountSid: "",
  twilioAuthToken: "",
} as BridgeConfig;

const fakeWs = () => ({ send: vi.fn(), readyState: 1 }) as never;

/** Lets the queued microtasks behind onToolCall's `void` run to completion. */
async function settle() {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

/**
 * A tool call that names a conversation the session was never bound to - what
 * a caller who talks the model into repeating an id would produce.
 */
function fireTransferNaming(conversationId: string) {
  clientOptions.onToolCall?.(
    "transfer_to_human",
    { reason: "wants a person", conversation_id: conversationId },
    "call-1",
  );
}

async function startVoiceSession(customParameters: Record<string, string>) {
  const session = new VoiceSession(fakeWs(), config);
  await session.handleTwilioMessage({
    event: "start",
    start: { streamSid: "MZ1", callSid: "CA1", customParameters },
  });
  return session;
}

beforeEach(() => {
  logLiveTransfer.mockReset();
  logLiveTransfer.mockResolvedValue({ id: "transfer-1" });
  getOnCallUsers.mockReset();
  getOnCallUsers.mockResolvedValue([{ id: "user-1", phoneNumber: "+15550000000" }]);
  submitToolOutput.mockReset();
});

describe("the transfer_to_human declaration", () => {
  it("asks the model for a reason and nothing else", () => {
    const params = TRANSFER_TO_HUMAN_TOOL.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(params.properties)).toEqual(["reason"]);
    expect(params.required).toEqual(["reason"]);
  });
});

describe("VoiceSession transfer_to_human", () => {
  it("logs the transfer against the conversation the stream named", async () => {
    const session = await startVoiceSession({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });

    fireTransferNaming("conversation-of-another-tenant");
    await settle();

    expect(logLiveTransfer).toHaveBeenCalledTimes(1);
    expect(logLiveTransfer.mock.calls[0][0]).toMatchObject({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });

    session.dispose();
  });

  it("refuses the transfer when the stream named no conversation", async () => {
    // The stream carried a tenant but no conversation - the only state in which
    // the old `this.conversationId ?? input.conversation_id` fallback could
    // fire, handing the model's id straight to logLiveTransfer.
    const session = await startVoiceSession({ tenantId: "tenant-1" });

    fireTransferNaming("conversation-of-another-tenant");
    await settle();

    expect(logLiveTransfer).not.toHaveBeenCalled();
    expect(submitToolOutput).toHaveBeenCalledWith(
      "call-1",
      JSON.stringify({ success: false }),
    );

    session.dispose();
  });
});

describe("ChatSession transfer_to_human", () => {
  it("logs the transfer against the conversation the session is bound to", async () => {
    const session = new ChatSession(
      fakeWs(),
      "tenant-1",
      "conversation-1",
      "identity-1",
      "session-token-1",
      config,
    );
    await session.start();

    fireTransferNaming("conversation-of-another-tenant");
    await settle();

    expect(logLiveTransfer).toHaveBeenCalledTimes(1);
    expect(logLiveTransfer.mock.calls[0][0]).toMatchObject({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });

    session.dispose();
  });

  it("does not throw when the handoff has already closed the realtime client", async () => {
    const session = new ChatSession(
      fakeWs(),
      "tenant-1",
      "conversation-1",
      "identity-1",
      "session-token-1",
      config,
    );
    await session.start();

    fireTransferNaming("conversation-of-another-tenant");
    await settle();

    // beginHandoff nulls the client, so there is no output left to submit - and
    // the attempt must not reject into onToolCall's floating promise.
    expect(submitToolOutput).not.toHaveBeenCalled();

    session.dispose();
  });
});
