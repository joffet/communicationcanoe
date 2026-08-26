import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bulk path's end of the attachment work: what the outbound-batch worker
 * hands `dispatchOutboundMessage` for a batch, and which SES API that turns
 * into.
 *
 * The assertion that matters is the negative one - a batch with nothing
 * attached must still go out on the plain SendEmailCommand, untouched by any
 * of this. That assertion is only worth anything next to its control (the
 * same call WITH an attachment reaching SendRawEmailCommand), because a
 * mistake that stopped attachments working at all would satisfy the negative
 * case perfectly.
 */

const ses = vi.hoisted(() => ({ commands: [] as { name: string; input: unknown }[] }));

vi.mock("@aws-sdk/client-ses", () => {
  class SendEmailCommand {
    constructor(readonly input: unknown) {
      ses.commands.push({ name: "SendEmailCommand", input });
    }
  }
  class SendRawEmailCommand {
    constructor(readonly input: unknown) {
      ses.commands.push({ name: "SendRawEmailCommand", input });
    }
  }
  class SESClient {
    async send() {
      return { MessageId: "ses-message-id" };
    }
  }
  return { SESClient, SendEmailCommand, SendRawEmailCommand };
});

const db = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[] }));

vi.mock("@communication-canoe/database", () => ({
  createDomainService: () => ({
    updateMessageDeliveryStatus: async (id: string, patch: Record<string, unknown>) => {
      db.patches.push({ id, ...patch });
      return { id, ...patch };
    },
  }),
}));

const { dispatchOutboundMessage } = await import("./dispatch-message");
const { createAttachmentFetchCache } = await import("./email/attachments");

const RESIDE_BASE = "https://api.reside.test";
const PDF_PATH = "/api/reservations/agreement-pdf/reservation-agreement-pdfs/cardiff/r-1.pdf";

/** Far enough ahead that the 30-minute signature reside mints is still live. */
function liveSignedUrl(): string {
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  return `${RESIDE_BASE}${PDF_PATH}?exp=${exp}&sig=abc`;
}

const tenant = {
  id: "tenant-1",
  inboundEmailAddress: "inbox@cardiff.test",
  twilioNumber: "+15550000000",
  resideAppUrl: null,
} as never;

function batchMessage() {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    channel: "email",
    senderType: "system",
    subject: "Notice",
    body: "<p>Your building has news.</p>",
  } as never;
}

let fetchCalls: string[];

beforeEach(() => {
  ses.commands = [];
  db.patches = [];
  fetchCalls = [];
  process.env.RESIDE_API_BASE = RESIDE_BASE;
  delete process.env.NEXT_PUBLIC_APP_URL;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    fetchCalls.push(String(input));
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a bulk batch with no attachments", () => {
  it("still sends on the plain SendEmailCommand path", async () => {
    // Exactly what the worker passes for `batch.attachments === null`.
    const sent = await dispatchOutboundMessage({
      tenant,
      message: batchMessage(),
      to: "resident@example.test",
      attachments: undefined,
      attachmentCache: createAttachmentFetchCache(),
    });

    expect(ses.commands.map((c) => c.name)).toEqual(["SendEmailCommand"]);
    expect(fetchCalls).toEqual([]);
    expect(sent.deliveryStatus).toBe("sent");
    expect(sent.providerMessageId).toBe("ses-message-id");
  });

  it("CONTROL: the same call with an attachment takes the raw-MIME path", async () => {
    // Without this the test above passes just as happily against a build where
    // attachments never reach SES at all.
    await dispatchOutboundMessage({
      tenant,
      message: batchMessage(),
      to: "resident@example.test",
      attachments: [
        { filename: "agreement.pdf", contentType: "application/pdf", url: liveSignedUrl() },
      ],
      attachmentCache: createAttachmentFetchCache(),
    });

    expect(ses.commands.map((c) => c.name)).toEqual(["SendRawEmailCommand"]);
    const raw = ses.commands[0].input as { RawMessage: { Data: Buffer } };
    expect(raw.RawMessage.Data.toString("utf8")).toContain("agreement.pdf");
    expect(fetchCalls).toEqual([`${RESIDE_BASE}${PDF_PATH}${new URL(liveSignedUrl()).search}`]);
  });
});

describe("the batch's attachment is fetched once, not once per recipient", () => {
  it("shares one fetch across every recipient in the drain pass", async () => {
    const attachments = [
      { filename: "agreement.pdf", contentType: "application/pdf" as const, url: liveSignedUrl() },
    ];
    const cache = createAttachmentFetchCache();

    // Three recipients of one batch, dispatched concurrently as the worker
    // does. One fetch, three raw sends: this is what keeps reside's 30-minute
    // signature a deadline on when the batch STARTS draining rather than on
    // how long it takes to finish.
    await Promise.all(
      ["a@example.test", "b@example.test", "c@example.test"].map((to) =>
        dispatchOutboundMessage({
          tenant,
          message: batchMessage(),
          to,
          attachments,
          attachmentCache: cache,
        }),
      ),
    );

    expect(fetchCalls).toHaveLength(1);
    expect(ses.commands.map((c) => c.name)).toEqual([
      "SendRawEmailCommand",
      "SendRawEmailCommand",
      "SendRawEmailCommand",
    ]);
  });

  it("CONTROL: without a cache each recipient fetches for itself", async () => {
    const attachments = [
      { filename: "agreement.pdf", contentType: "application/pdf" as const, url: liveSignedUrl() },
    ];

    await Promise.all(
      ["a@example.test", "b@example.test"].map((to) =>
        dispatchOutboundMessage({ tenant, message: batchMessage(), to, attachments }),
      ),
    );

    expect(fetchCalls).toHaveLength(2);
  });
});

describe("an attachment that cannot be delivered", () => {
  it("drops a lapsed signature and still sends the email", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60 * 60;
    const sent = await dispatchOutboundMessage({
      tenant,
      message: batchMessage(),
      to: "resident@example.test",
      attachments: [
        {
          filename: "agreement.pdf",
          contentType: "application/pdf",
          url: `${RESIDE_BASE}${PDF_PATH}?exp=${expiredAt}&sig=abc`,
        },
      ],
      attachmentCache: createAttachmentFetchCache(),
    });

    // Not even attempted - reside would answer 404, and the drop is named in
    // the log rather than left looking like a bad path.
    expect(fetchCalls).toEqual([]);
    expect(ses.commands.map((c) => c.name)).toEqual(["SendEmailCommand"]);
    expect(sent.deliveryStatus).toBe("sent");
  });

  it("drops a refused URL and still sends the email", async () => {
    const sent = await dispatchOutboundMessage({
      tenant,
      message: batchMessage(),
      to: "resident@example.test",
      attachments: [
        {
          filename: "agreement.pdf",
          contentType: "application/pdf",
          url: "https://evil.test/api/not-an-agreement/x.pdf",
        },
      ],
      attachmentCache: createAttachmentFetchCache(),
    });

    expect(fetchCalls).toEqual([]);
    expect(ses.commands.map((c) => c.name)).toEqual(["SendEmailCommand"]);
    expect(sent.deliveryStatus).toBe("sent");
  });

  it("drops one that fails to fetch and still sends the email", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      fetchCalls.push(String(input));
      return new Response("nope", { status: 404 });
    });

    const sent = await dispatchOutboundMessage({
      tenant,
      message: batchMessage(),
      to: "resident@example.test",
      attachments: [
        { filename: "agreement.pdf", contentType: "application/pdf", url: liveSignedUrl() },
      ],
      attachmentCache: createAttachmentFetchCache(),
    });

    expect(fetchCalls).toHaveLength(1);
    expect(ses.commands.map((c) => c.name)).toEqual(["SendEmailCommand"]);
    expect(sent.deliveryStatus).toBe("sent");
  });
});
