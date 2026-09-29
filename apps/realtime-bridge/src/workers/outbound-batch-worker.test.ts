import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Follow-up threading in the bulk worker.
 *
 * The lookup is caller-supplied input, so the cases that matter are the ones
 * where it must NOT thread - and that the email still goes out in all of them.
 */

const state = vi.hoisted(() => ({
  pending: [] as any[],
  providerIds: new Map<string, string | null>(),
  dispatched: [] as any[],
  lookupThrows: false,
}));

vi.mock("@communication-canoe/database", () => {
  const domain = {
    reclaimStuckOutboundBatchRecipients: async () => 0,
    listPendingOutboundBatchRecipients: async () => state.pending.splice(0),
    claimOutboundBatchRecipient: async () => ({}),
    getOutboundBatch: async () => ({ subject: "Follow-up", fromAddress: null, attachments: null }),
    findOrCreateIdentity: async () => ({ id: "identity-1" }),
    findOrCreateConversation: async () => ({ conversation: { id: "conversation-1" } }),
    appendMessage: async () => ({ id: "message-new" }),
    // Models the tenant predicate of the real query.
    getProviderMessageId: async (tenantId: string, messageId: string) => {
      if (state.lookupThrows) throw new Error("db down");
      return state.providerIds.get(`${tenantId}:${messageId}`) ?? null;
    },
    updateOutboundBatchRecipientStatus: async () => undefined,
    incrementOutboundBatchCompleted: async () => undefined,
  };
  return {
    createDomainService: () => domain,
    createAdminService: () => ({ getTenantById: async () => ({ id: "tenant-a" }) }),
  };
});

vi.mock("@communication-canoe/messaging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@communication-canoe/messaging")>()),
  dispatchOutboundMessage: async (opts: unknown) => {
    state.dispatched.push(opts);
    return { id: "message-new", deliveryStatus: "sent" };
  },
}));

const { startOutboundBatchWorker } = await import("./outbound-batch-worker");

const ORIGINAL = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID = "010d01a0e9541e16-9af3a728-0ae0-47d2-80ea-27f8aab6bb62-000000";

function recipient(overrides: Record<string, unknown> = {}) {
  return {
    id: "recipient-1",
    batchId: "batch-1",
    tenantId: "tenant-a",
    channel: "email",
    identityContact: { email: "resident@example.test" },
    body: "<p>Update</p>",
    unsubscribeUrl: null,
    inReplyToMessageId: ORIGINAL,
    ...overrides,
  };
}

async function drain() {
  await vi.advanceTimersByTimeAsync(7_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.pending = [];
  state.providerIds = new Map();
  state.dispatched = [];
  state.lookupThrows = false;
  startOutboundBatchWorker();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("outbound batch worker: follow-up threading", () => {
  it("adds In-Reply-To and References beside the unsubscribe headers", async () => {
    state.providerIds.set(`tenant-a:${ORIGINAL}`, PROVIDER_ID);
    state.pending = [recipient({ unsubscribeUrl: "https://onecardiff.ca/u?t=abc" })];

    await drain();

    expect(state.dispatched).toHaveLength(1);
    const headers = state.dispatched[0].headers;
    expect(headers["In-Reply-To"]).toMatch(new RegExp(`^<${PROVIDER_ID}@[a-z0-9-]+\\.amazonses\\.com>$`));
    expect(headers.References).toBe(headers["In-Reply-To"]);
    expect(headers["List-Unsubscribe"]).toBe("<https://onecardiff.ca/u?t=abc>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("sends unthreaded when the referenced message does not exist", async () => {
    state.pending = [recipient({ unsubscribeUrl: "https://onecardiff.ca/u?t=abc" })];

    await drain();

    expect(state.dispatched).toHaveLength(1);
    expect(Object.keys(state.dispatched[0].headers)).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
  });

  it("sends unthreaded when the message belongs to another tenant", async () => {
    state.providerIds.set(`tenant-b:${ORIGINAL}`, PROVIDER_ID);
    state.pending = [recipient()];

    await drain();

    expect(state.dispatched).toHaveLength(1);
    expect(state.dispatched[0].headers).toBeUndefined();
  });

  it("sends unthreaded when the message has no provider id", async () => {
    state.providerIds.set(`tenant-a:${ORIGINAL}`, null);
    state.pending = [recipient()];

    await drain();

    expect(state.dispatched).toHaveLength(1);
    expect(state.dispatched[0].headers).toBeUndefined();
  });

  it("still sends when the lookup itself throws", async () => {
    state.lookupThrows = true;
    state.pending = [recipient()];

    await drain();

    expect(state.dispatched).toHaveLength(1);
    expect(state.dispatched[0].headers).toBeUndefined();
  });

  it("never threads an SMS", async () => {
    state.providerIds.set(`tenant-a:${ORIGINAL}`, PROVIDER_ID);
    state.pending = [recipient({ channel: "sms", identityContact: { phone: "+15550001111" } })];

    await drain();

    expect(state.dispatched).toHaveLength(1);
    expect(state.dispatched[0].headers).toBeUndefined();
  });
});
