import { describe, expect, it } from "vitest";
import { sesMessageIdHeader } from "./ses";
import { buildBulkEmailHeaders } from "./bulk-headers";

const PROVIDER_ID = "010d01a0e9541e16-9af3a728-0ae0-47d2-80ea-27f8aab6bb62-000000";

describe("sesMessageIdHeader", () => {
  it("uses the regional amazonses.com host", () => {
    expect(sesMessageIdHeader(PROVIDER_ID, "ca-central-1")).toBe(
      `<${PROVIDER_ID}@ca-central-1.amazonses.com>`,
    );
  });

  it("uses email.amazonses.com for us-east-1", () => {
    expect(sesMessageIdHeader(PROVIDER_ID, "us-east-1")).toBe(
      `<${PROVIDER_ID}@email.amazonses.com>`,
    );
  });
});

describe("buildBulkEmailHeaders", () => {
  it("is undefined with nothing to send, keeping the plain SES path", () => {
    expect(buildBulkEmailHeaders({})).toBeUndefined();
    expect(buildBulkEmailHeaders({ unsubscribeUrl: null, referencedProviderMessageId: null })).toBeUndefined();
  });

  it("adds In-Reply-To and References for a referenced message", () => {
    expect(buildBulkEmailHeaders({ referencedProviderMessageId: PROVIDER_ID, region: "ca-central-1" })).toEqual({
      "In-Reply-To": `<${PROVIDER_ID}@ca-central-1.amazonses.com>`,
      References: `<${PROVIDER_ID}@ca-central-1.amazonses.com>`,
    });
  });

  it("merges threading with the unsubscribe pair", () => {
    expect(
      buildBulkEmailHeaders({
        unsubscribeUrl: "https://onecardiff.ca/u?t=abc",
        referencedProviderMessageId: PROVIDER_ID,
        region: "ca-central-1",
      }),
    ).toEqual({
      "List-Unsubscribe": "<https://onecardiff.ca/u?t=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "In-Reply-To": `<${PROVIDER_ID}@ca-central-1.amazonses.com>`,
      References: `<${PROVIDER_ID}@ca-central-1.amazonses.com>`,
    });
  });

  it("omits threading when only the unsubscribe link is given", () => {
    const headers = buildBulkEmailHeaders({ unsubscribeUrl: "https://onecardiff.ca/u?t=abc" });
    expect(Object.keys(headers ?? {})).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
  });
});
