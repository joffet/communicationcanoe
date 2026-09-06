import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * List-Unsubscribe on the outbound email path.
 *
 * The failure this guards against is silent by construction: SES's plain
 * SendEmailCommand has no parameter for a custom header, so a build that
 * forgot to switch paths would send every message successfully, with the
 * header quietly dropped and no error anywhere. The assertion is therefore
 * about which SES API was called, and about the bytes it was handed.
 */

const ses = vi.hoisted(() => ({ commands: [] as { name: string; input: any }[] }));

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

vi.mock("@communication-canoe/database", () => ({
  createDomainService: () => ({
    updateMessageDeliveryStatus: async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }),
  }),
}));

const { dispatchOutboundMessage } = await import("./dispatch-message");

const tenant = {
  id: "tenant-1",
  inboundEmailAddress: "inbox@cardiff.test",
  twilioNumber: "+15550000000",
  resideAppUrl: null,
} as never;

function emailMessage() {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    channel: "email",
    senderType: "system",
    subject: "Guest parking request",
    body: "<p>Somebody wants a visitor spot.</p>",
  } as never;
}

const UNSUBSCRIBE = {
  "List-Unsubscribe": "<https://onecardiff.ca/api/notifications/unsubscribe?t=abc>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
};

beforeEach(() => {
  ses.commands = [];
});

describe("unsubscribe headers on an outbound email", () => {
  it("CONTROL: a send without them takes the plain SendEmailCommand path", async () => {
    // Without this the assertion below passes just as happily against a build
    // that had put every email on the raw path for unrelated reasons.
    await dispatchOutboundMessage({
      tenant,
      message: emailMessage(),
      to: "resident@example.test",
    });

    expect(ses.commands.map((command) => command.name)).toEqual(["SendEmailCommand"]);
  });

  it("switches to raw MIME, because SendEmailCommand cannot carry a header", async () => {
    await dispatchOutboundMessage({
      tenant,
      message: emailMessage(),
      to: "resident@example.test",
      headers: UNSUBSCRIBE,
    });

    expect(ses.commands.map((command) => command.name)).toEqual(["SendRawEmailCommand"]);
  });

  it("puts both headers in the message bytes SES is handed", async () => {
    // The path being right is not the same as the header arriving: nodemailer
    // builds the MIME, and a dropped option here would look identical above.
    await dispatchOutboundMessage({
      tenant,
      message: emailMessage(),
      to: "resident@example.test",
      headers: UNSUBSCRIBE,
    });

    const raw = Buffer.from(ses.commands[0].input.RawMessage.Data).toString("utf8");
    // Unfolded first. A real token runs to a few hundred characters, so
    // nodemailer always wraps this header onto a continuation line - which is
    // ordinary RFC 5322 folding, and what every receiver undoes before reading
    // the value. Asserting the wrapped bytes would be asserting nodemailer's
    // line-length rather than that the header is there.
    const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
    expect(unfolded).toContain(
      "List-Unsubscribe: <https://onecardiff.ca/api/notifications/unsubscribe?t=abc>"
    );
    expect(unfolded).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("ignores them on the SMS branch, which has no headers to carry", async () => {
    await dispatchOutboundMessage({
      tenant,
      message: { ...(emailMessage() as any), channel: "sms" } as never,
      to: "+15551234567",
      headers: UNSUBSCRIBE,
    });

    expect(ses.commands).toEqual([]);
  });
});
