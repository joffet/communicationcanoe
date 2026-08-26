import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedAttachmentUrl, resolveAttachmentUrl } from "./attachments";

/**
 * isAllowedAttachmentUrl is the whole SSRF defense for the attachment-fetch
 * path: reside hands comm-canoe a URL, and comm-canoe's server fetches it.
 * Everything this test pins is a way that check must fail closed - no
 * RESIDE_API_BASE configured, a different host, a different port, a
 * protocol downgrade/upgrade, or a scheme this fetch has no business
 * following.
 */

const ORIGINAL_RESIDE_API_BASE = process.env.RESIDE_API_BASE;

beforeEach(() => {
  process.env.RESIDE_API_BASE = "https://app.reside.example";
});

afterEach(() => {
  if (ORIGINAL_RESIDE_API_BASE === undefined) {
    delete process.env.RESIDE_API_BASE;
  } else {
    process.env.RESIDE_API_BASE = ORIGINAL_RESIDE_API_BASE;
  }
});

describe("isAllowedAttachmentUrl", () => {
  it("allows a URL on the same origin as RESIDE_API_BASE", () => {
    // The path matters now as well as the origin: this fixture used to say
    // /api/images/..., the public proxy reside served these from before they
    // moved behind their own signed route. It never matched a real URL.
    expect(
      isAllowedAttachmentUrl(
        "https://app.reside.example/api/reservations/agreement-pdf/reservation-agreement-pdfs/cardiff/r1.pdf",
      ),
    ).toBe(true);
  });

  it("rejects a different host entirely", () => {
    expect(isAllowedAttachmentUrl("https://evil.example/api/images/x.pdf")).toBe(false);
  });

  it("rejects a lookalike host (subdomain/suffix tricks)", () => {
    expect(isAllowedAttachmentUrl("https://app.reside.example.evil.com/x.pdf")).toBe(false);
    expect(isAllowedAttachmentUrl("https://evil-app.reside.example/x.pdf")).toBe(false);
  });

  it("rejects a scheme downgrade to http when RESIDE_API_BASE is https", () => {
    expect(isAllowedAttachmentUrl("http://app.reside.example/x.pdf")).toBe(false);
  });

  it("rejects a different port on the same host", () => {
    expect(isAllowedAttachmentUrl("https://app.reside.example:8443/x.pdf")).toBe(false);
  });

  it("rejects a non-http(s) scheme (file/data URLs can't be fetched safely)", () => {
    expect(isAllowedAttachmentUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedAttachmentUrl("data:application/pdf;base64,AAAA")).toBe(false);
  });

  it("rejects a malformed URL rather than throwing", () => {
    expect(isAllowedAttachmentUrl("not a url")).toBe(false);
  });

  it("fails closed when RESIDE_API_BASE is not configured", () => {
    delete process.env.RESIDE_API_BASE;
    expect(isAllowedAttachmentUrl("https://app.reside.example/x.pdf")).toBe(false);
  });

  it("fails closed when RESIDE_API_BASE itself is malformed", () => {
    process.env.RESIDE_API_BASE = "not a url";
    expect(isAllowedAttachmentUrl("https://app.reside.example/x.pdf")).toBe(false);
  });
});

describe("resolveAttachmentUrl", () => {
  const PATH = "/api/reservations/agreement-pdf/reservation-agreement-pdfs/cardiff/r-1.pdf?exp=1&sig=x";

  beforeEach(() => {
    process.env.RESIDE_API_BASE = "https://api.resideplatform.co";
  });

  it("rehosts a URL sent on a different alias of the same deployment", () => {
    // The production failure: reside builds these from BETTER_AUTH_URL
    // (http://onecardiff.ca) while this service is configured with
    // api.resideplatform.co. Two aliases, two origins, every PDF refused.
    expect(resolveAttachmentUrl(`http://onecardiff.ca${PATH}`)).toBe(
      `https://api.resideplatform.co${PATH}`
    );
  });

  it("accepts a bare path", () => {
    expect(resolveAttachmentUrl(PATH)).toBe(`https://api.resideplatform.co${PATH}`);
  });

  it("cannot be pointed at another host", () => {
    // The host is discarded, not validated - so this resolves onto reside's
    // origin rather than being fetched from the attacker's.
    expect(resolveAttachmentUrl(`https://evil.example${PATH}`)).toBe(
      `https://api.resideplatform.co${PATH}`
    );
  });

  it("refuses a path outside the attachment route", () => {
    expect(resolveAttachmentUrl("https://api.resideplatform.co/api/admin/secrets")).toBeNull();
    expect(resolveAttachmentUrl("/etc/passwd")).toBeNull();
  });

  it("refuses a path that escapes the prefix by traversal", () => {
    expect(resolveAttachmentUrl("/api/reservations/agreement-pdf/../../admin/secrets")).toBeNull();
  });

  it("fails closed when RESIDE_API_BASE is unset", () => {
    delete process.env.RESIDE_API_BASE;
    expect(resolveAttachmentUrl(`https://api.resideplatform.co${PATH}`)).toBeNull();
  });
});
