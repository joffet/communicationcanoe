import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Once the provider has accepted an email, the message is sent - whatever the
 * database does next. 2026-09-28: the cluster ran out of connection slots
 * mid-Notice, the "sent" write failed after SES had the message, and the catch
 * recorded 27 delivered emails as failed. 23 of them were opened.
 */

const ses = vi.hoisted(() => ({ refuse: false }));

vi.mock("@aws-sdk/client-ses", () => {
  class SendEmailCommand {
    constructor(readonly input: unknown) {}
  }
  class SendRawEmailCommand {
    constructor(readonly input: unknown) {}
  }
  class SESClient {
    async send() {
      if (ses.refuse) throw new Error("MessageRejected: Email address is not verified.");
      return { MessageId: "ses-message-id" };
    }
  }
  return { SESClient, SendEmailCommand, SendRawEmailCommand };
});

const db = vi.hoisted(() => ({
  patches: [] as Record<string, unknown>[],
  failuresLeft: 0,
}));

function connectionError(): Error {
  return new Error('Failed query: update "messages" set "provider_message_id" = $1', {
    cause: new Error("remaining connection slots are reserved for roles with the SUPERUSER attribute"),
  });
}

vi.mock("@communication-canoe/database", () => ({
  createDomainService: () => ({
    updateMessageDeliveryStatus: async (id: string, patch: Record<string, unknown>) => {
      db.patches.push({ id, ...patch });
      if (db.failuresLeft > 0) {
        db.failuresLeft -= 1;
        throw connectionError();
      }
      return { id, ...patch };
    },
  }),
}));

const { dispatchOutboundMessage } = await import("./dispatch-message");
const { describeError } = await import("./record-with-retry");

const tenant = {
  id: "tenant-1",
  inboundEmailAddress: "inbox@cardiff.test",
  twilioNumber: "+15550000000",
  resideAppUrl: null,
} as never;

const message = {
  id: "message-1",
  conversationId: "conversation-1",
  channel: "email",
  senderType: "system",
  subject: "Notice",
  body: "<p>New fobs.</p>",
  deliveryStatus: "queued",
  deliveryAttempts: 0,
} as never;

function send() {
  return dispatchOutboundMessage({ tenant, message, to: "resident@example.test" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.patches = [];
  db.failuresLeft = 0;
  ses.refuse = false;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("after the provider accepts the email", () => {
  it("retries the sent write through a passing database fault", async () => {
    db.failuresLeft = 2;
    const pending = send();
    await vi.runAllTimersAsync();
    const sent = await pending;

    expect(sent.deliveryStatus).toBe("sent");
    expect(sent.providerMessageId).toBe("ses-message-id");
    expect(db.patches.map((p) => p.deliveryStatus)).toEqual(["sent", "sent", "sent"]);
  });

  it("never records failed, even when every write is lost", async () => {
    db.failuresLeft = 100;
    const pending = send();
    await vi.runAllTimersAsync();
    const sent = await pending;

    expect(sent.deliveryStatus).toBe("sent");
    expect(sent.providerMessageId).toBe("ses-message-id");
    expect(sent.deliveryError).toBeNull();
    expect(db.patches.some((p) => p.deliveryStatus === "failed")).toBe(false);
  });
});

describe("CONTROL: a provider refusal is still a failure", () => {
  it("records failed with the provider's reason", async () => {
    ses.refuse = true;
    const sent = await send();

    expect(sent.deliveryStatus).toBe("failed");
    expect(sent.deliveryError).toContain("MessageRejected");
  });
});

describe("describeError", () => {
  it("leads with the driver's reason instead of Drizzle's statement dump", () => {
    expect(describeError(connectionError())).toBe(
      'remaining connection slots are reserved for roles with the SUPERUSER attribute (Failed query: update "messages" set "provider_message_id" = $1)',
    );
  });
});
