import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedAttachmentUrl } from "./attachments";

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
    expect(
      isAllowedAttachmentUrl("https://app.reside.example/api/images/reservation-agreement-pdfs/cardiff/r1.pdf"),
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
