import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTenantByWidgetKey = vi.fn();

vi.mock("@communication-canoe/database", () => ({
  createDomainService: () => ({
    resolveTenantByWidgetKey,
    resumeConversationBySessionToken: vi.fn(),
    findOrCreateAnonymousIdentity: vi.fn(async () => ({ id: "identity-1" })),
    findOrCreateIdentity: vi.fn(async () => ({ id: "identity-1" })),
    findOrCreateConversation: vi.fn(async () => ({
      conversation: { id: "conversation-1" },
    })),
    createChatSessionToken: () => "session-token-1",
  }),
}));

/** Resolved by each test to let chatSession.start() finish on cue. */
let releaseStart: () => void;
let startCalled: Promise<void>;
let handled: string[];

vi.mock("../sessions/chat-session.js", () => ({
  ChatSession: class {
    constructor(..._args: unknown[]) {}
    start = vi.fn(() => {
      announceStart();
      return startGate;
    });
    handleVisitorMessage = vi.fn(async (text: string) => {
      handled.push(text);
      // Yield so a message that arrives mid-drain has a chance to overtake the
      // queue if the drain is not serialized.
      await Promise.resolve();
    });
    dispose = vi.fn();
  },
}));

let startGate: Promise<void>;
let announceStart: () => void;

const { handleChatConnection } = await import("./chat-widget.js");

class FakeSocket extends EventEmitter {
  sent: Array<Record<string, unknown>> = [];
  closed = false;

  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }

  close() {
    this.closed = true;
  }

  receive(msg: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
}

const config = {} as Parameters<typeof handleChatConnection>[1];

/** Lets queued microtasks (the async message handlers) run to completion. */
async function settle() {
  for (let i = 0; i < 500; i += 1) await Promise.resolve();
}

function connect() {
  const ws = new FakeSocket();
  handleChatConnection(ws as never, config);
  return ws;
}

beforeEach(() => {
  handled = [];
  resolveTenantByWidgetKey.mockReset();
  resolveTenantByWidgetKey.mockResolvedValue({ id: "tenant-1" });
  startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  startCalled = new Promise<void>((resolve) => {
    announceStart = resolve;
  });
});

describe("handleChatConnection", () => {
  it("queues a message that arrives while the session is still starting", async () => {
    const ws = connect();
    ws.receive({ type: "init", widgetKey: "wk" });
    await startCalled;

    // The visitor has the session token by now and types straight away.
    expect(ws.sent.map((m) => m.type)).toContain("session");
    ws.receive({ type: "message", text: "hello?" });
    await settle();

    expect(ws.sent.filter((m) => m.code === "not_initialized")).toHaveLength(0);
    expect(handled).toEqual([]);

    releaseStart();
    await settle();

    expect(handled).toEqual(["hello?"]);
  });

  it("replays queued messages in the order the visitor sent them", async () => {
    const ws = connect();
    ws.receive({ type: "init", widgetKey: "wk" });
    await startCalled;

    ws.receive({ type: "message", text: "one" });
    ws.receive({ type: "message", text: "two" });
    await settle();

    releaseStart();
    await settle();

    expect(handled).toEqual(["one", "two"]);
  });

  it("does not let a message arriving mid-replay overtake the queue", async () => {
    const ws = connect();
    ws.receive({ type: "init", widgetKey: "wk" });
    await startCalled;

    ws.receive({ type: "message", text: "one" });
    ws.receive({ type: "message", text: "two" });

    releaseStart();
    // No settle() first: "three" lands while the queue is being drained.
    ws.receive({ type: "message", text: "three" });
    await settle();

    expect(handled).toEqual(["one", "two", "three"]);
  });

  it("still rejects a message sent before any init", async () => {
    const ws = connect();
    ws.receive({ type: "message", text: "hello?" });
    await settle();

    expect(ws.sent).toEqual([{ type: "error", code: "not_initialized" }]);
    expect(handled).toEqual([]);
  });

  it("rejects a message queued behind an init that failed", async () => {
    resolveTenantByWidgetKey.mockResolvedValue(null);

    const ws = connect();
    ws.receive({ type: "init", widgetKey: "bogus" });
    await settle();
    ws.receive({ type: "message", text: "hello?" });
    await settle();

    expect(ws.sent).toEqual([
      { type: "error", code: "invalid_widget_key" },
      { type: "error", code: "not_initialized" },
    ]);
    expect(handled).toEqual([]);
  });

  it("caps the pre-init queue instead of buffering without limit", async () => {
    const ws = connect();
    ws.receive({ type: "init", widgetKey: "wk" });
    await startCalled;

    for (let i = 0; i < 40; i += 1) ws.receive({ type: "message", text: `m${i}` });
    await settle();

    expect(ws.sent.filter((m) => m.code === "too_many_pending")).toHaveLength(8);

    releaseStart();
    await settle();

    expect(handled).toHaveLength(32);
    expect(handled[0]).toBe("m0");
    expect(handled[31]).toBe("m31");
  });
});
