import { describe, expect, it } from "vitest";
import {
  resideSendBulkMessageInputSchema,
  resideSendMessageInputSchema,
} from "./index";

/**
 * The bulk send's attachments field, which exists so a Notice can carry the
 * agreement PDF a single send already can (#45/#46).
 *
 * Deliberately pinned AGAINST the single-send schema rather than restated:
 * both sides feed the same fetch/validate path in
 * packages/messaging/src/email/attachments.ts, and a bulk schema that drifted
 * wider than the single one would let a request through that the fetcher then
 * refuses - silently, since a refused attachment is dropped rather than
 * failing the send.
 */

const BULK = {
  tenantId: "client-cardiff",
  channel: "email" as const,
  subject: "Notice",
  body: "<p>Your building has news.</p>",
  recipients: [{ email: "resident@example.test" }],
};

const ATTACHMENT = {
  filename: "agreement.pdf",
  contentType: "application/pdf",
  url: "http://onecardiff.ca/api/reservations/agreement-pdf/reservation-agreement-pdfs/cardiff/r-1.pdf?exp=1787601713&sig=abc",
};

/** The control every rejection below is read against: this payload, minus
 * whatever that case is changing, parses. Without it a schema that rejected
 * the fixture for some unrelated reason would look like a passing suite. */
it("CONTROL: the base bulk payload parses, with and without attachments", () => {
  expect(resideSendBulkMessageInputSchema.safeParse(BULK).success).toBe(true);
  expect(
    resideSendBulkMessageInputSchema.safeParse({ ...BULK, attachments: [ATTACHMENT] }).success,
  ).toBe(true);
});

describe("resideSendBulkMessageInputSchema.attachments", () => {
  it("is optional - Notices, bulk's only caller today, send nothing", () => {
    const parsed = resideSendBulkMessageInputSchema.parse(BULK);
    expect(parsed.attachments).toBeUndefined();
  });

  it("carries the reference through untouched", () => {
    const parsed = resideSendBulkMessageInputSchema.parse({
      ...BULK,
      attachments: [ATTACHMENT],
    });
    expect(parsed.attachments).toEqual([ATTACHMENT]);
  });

  it("caps at 5, the same MAX_ATTACHMENTS_PER_MESSAGE the fetcher enforces", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...ATTACHMENT, filename: `a${i}.pdf` }));
    expect(resideSendBulkMessageInputSchema.safeParse({ ...BULK, attachments: five }).success).toBe(
      true,
    );
    expect(
      resideSendBulkMessageInputSchema.safeParse({
        ...BULK,
        attachments: [...five, { ...ATTACHMENT, filename: "a5.pdf" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a contentType the raw-MIME path will not send", () => {
    expect(
      resideSendBulkMessageInputSchema.safeParse({
        ...BULK,
        attachments: [{ ...ATTACHMENT, contentType: "application/zip" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a url that is not a URL, and an empty filename", () => {
    expect(
      resideSendBulkMessageInputSchema.safeParse({
        ...BULK,
        attachments: [{ ...ATTACHMENT, url: "not a url" }],
      }).success,
    ).toBe(false);
    expect(
      resideSendBulkMessageInputSchema.safeParse({
        ...BULK,
        attachments: [{ ...ATTACHMENT, filename: "" }],
      }).success,
    ).toBe(false);
  });
});

describe("parity with the single send", () => {
  const SINGLE = {
    tenantId: "client-cardiff",
    channel: "email" as const,
    identity: { email: "resident@example.test" },
    subject: "Notice",
    body: "<p>Your building has news.</p>",
  };

  const cases: { name: string; attachments: unknown }[] = [
    { name: "a valid reference", attachments: [ATTACHMENT] },
    { name: "an empty list", attachments: [] },
    { name: "six references", attachments: Array.from({ length: 6 }, () => ATTACHMENT) },
    { name: "a non-pdf contentType", attachments: [{ ...ATTACHMENT, contentType: "text/plain" }] },
    { name: "a missing url", attachments: [{ filename: "a.pdf", contentType: "application/pdf" }] },
    { name: "an over-long filename", attachments: [{ ...ATTACHMENT, filename: "x".repeat(256) }] },
  ];

  it.each(cases)("accepts or rejects $name the same way on both endpoints", ({ attachments }) => {
    const single = resideSendMessageInputSchema.safeParse({ ...SINGLE, attachments });
    const bulk = resideSendBulkMessageInputSchema.safeParse({ ...BULK, attachments });
    expect(bulk.success).toBe(single.success);
  });
});
