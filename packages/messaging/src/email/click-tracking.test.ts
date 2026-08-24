import { beforeEach, describe, expect, it } from "vitest";
import { withClickTracking } from "./click-tracking";
import {
  createEmailClickToken,
  isRedirectableUrl,
  verifyEmailClickToken,
} from "./click-tracking-token";

const APP = "https://canoe.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP;
  process.env.CHAT_SESSION_SECRET = "test-secret";
});

/** The destination a rewritten anchor actually sends somebody to. */
function destinationOf(html: string): string | null {
  const token = /\/api\/track\/click\?t=([^"']+)/.exec(html)?.[1];
  if (!token) return null;
  return verifyEmailClickToken(token.replace(/&amp;/g, "&"))?.url ?? null;
}

describe("withClickTracking", () => {
  it("routes an ordinary link through the recorder and preserves the destination", () => {
    const html = withClickTracking('<a href="https://x.test/go">Book it</a>', "msg-1");

    expect(html).toContain(`${APP}/api/track/click?t=`);
    expect(html).not.toContain("https://x.test/go");
    expect(destinationOf(html)).toBe("https://x.test/go");
    // The visible text is the author's and must survive untouched.
    expect(html).toContain(">Book it</a>");
  });

  it("keeps every other attribute on the anchor", () => {
    const html = withClickTracking(
      '<a class="btn" href="https://x.test/go" style="color:#fff" target="_blank">Go</a>',
      "msg-1",
    );
    expect(html).toContain('class="btn"');
    expect(html).toContain('style="color:#fff"');
    expect(html).toContain('target="_blank"');
  });

  /* The pixel withOpenTrackingPixel just appended is an <img>. Rewriting it
   * would point the open tracker at the click tracker and lose every open. */
  it("leaves the open-tracking pixel alone", () => {
    const pixel = `<img src="${APP}/api/track/email-open?t=abc" width="1" height="1" />`;
    expect(withClickTracking(`<p>hi</p>${pixel}`, "msg-1")).toContain(pixel);
  });

  /* A rewritten mailto is a broken link, not a tracked one. */
  it("leaves mailto, tel, anchors and relative hrefs alone", () => {
    for (const href of ["mailto:a@b.test", "tel:+15550000000", "#section", "/member/notices"]) {
      const html = withClickTracking(`<a href="${href}">x</a>`, "msg-1");
      expect(html).toBe(`<a href="${href}">x</a>`);
    }
  });

  /* An href reaches here as a string in admin-authored HTML. A redirector
   * that emits any scheme it is handed is a cross-site scripting primitive
   * with a trusted domain in front of it. */
  it("refuses to rewrite a javascript: or data: href", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      expect(withClickTracking(`<a href="${href}">x</a>`, "msg-1")).toContain(href);
    }
  });

  /* Stored HTML entity-encodes a query separator. Signing the encoded form
   * would redirect to a URL whose second parameter is literally named
   * "amp;utm_source" - a subtly different page than the author linked. */
  it("decodes entities in an href before signing the destination", () => {
    const html = withClickTracking(
      '<a href="https://x.test/go?a=1&amp;b=2">x</a>',
      "msg-1",
    );
    expect(destinationOf(html)).toBe("https://x.test/go?a=1&b=2");
  });

  it("re-encodes the token so it is a valid HTML attribute", () => {
    const html = withClickTracking('<a href="https://x.test/go">x</a>', "msg-1");
    // A bare & inside an attribute is malformed HTML; some clients truncate
    // the URL at it.
    expect(html).not.toMatch(/href="[^"]*[^m&]&(?!amp;)/);
  });

  it("rewrites every link, not only the first", () => {
    const html = withClickTracking(
      '<a href="https://a.test">a</a><p>x</p><a href="https://b.test">b</a>',
      "msg-1",
    );
    expect(html.match(/\/api\/track\/click/g)).toHaveLength(2);
  });

  it("gives two recipients different tokens for the same link", () => {
    const one = withClickTracking('<a href="https://x.test">x</a>', "msg-1");
    const two = withClickTracking('<a href="https://x.test">x</a>', "msg-2");
    expect(one).not.toBe(two);
  });

  /* Tracking is best-effort and must never break a send. */
  it("returns the html untouched when there is no app url", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const html = '<a href="https://x.test/go">x</a>';
    expect(withClickTracking(html, "msg-1")).toBe(html);
  });

  it("returns the html untouched when the signing secret is missing", () => {
    delete process.env.CHAT_SESSION_SECRET;
    delete process.env.INTERNAL_API_SECRET;
    const html = '<a href="https://x.test/go">x</a>';
    expect(withClickTracking(html, "msg-1")).toBe(html);
  });

  it("does not rewrite a link it already rewrote", () => {
    const once = withClickTracking('<a href="https://x.test/go">x</a>', "msg-1");
    expect(withClickTracking(once, "msg-1")).toBe(once);
  });
});

describe("the click token", () => {
  /**
   * The security property this whole design exists for.
   *
   * The obvious shape is `?t=<signed message id>&u=<url>`, and it is an open
   * redirect - the signature covers the id, nothing covers the url, and every
   * resident in the building is holding one of these links. Signing the pair
   * means there is no unsigned parameter to tamper with.
   */
  it("refuses a token whose destination was swapped", () => {
    const token = createEmailClickToken("msg-1", "https://good.test/go");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
    );
    const forged = Buffer.from(
      JSON.stringify({ ...payload, url: "https://evil.test" }),
    ).toString("base64url");

    // Same signature, different payload.
    expect(verifyEmailClickToken(`${forged}.${token.split(".")[1]}`)).toBeNull();
  });

  it("refuses a tampered signature and a malformed token", () => {
    const token = createEmailClickToken("msg-1", "https://good.test/go");
    expect(verifyEmailClickToken(`${token.split(".")[0]}.deadbeef`)).toBeNull();
    expect(verifyEmailClickToken("nonsense")).toBeNull();
    expect(verifyEmailClickToken("")).toBeNull();
  });

  it("refuses an expired token", () => {
    expect(verifyEmailClickToken(createEmailClickToken("msg-1", "https://x.test", -1))).toBeNull();
  });

  /* A signature over a payload with a javascript: url is still a valid
   * signature. The shape is checked as well, so a token minted before this
   * rule existed cannot be replayed into a script URL. */
  it("refuses a validly signed token carrying an unredirectable scheme", () => {
    const token = createEmailClickToken("msg-1", "javascript:alert(1)");
    expect(verifyEmailClickToken(token)).toBeNull();
  });

  it("round-trips a real destination", () => {
    const payload = verifyEmailClickToken(
      createEmailClickToken("msg-1", "https://x.test/go?a=1&b=2"),
    );
    expect(payload).toMatchObject({ messageId: "msg-1", url: "https://x.test/go?a=1&b=2" });
  });

  it("allows only http and https", () => {
    expect(isRedirectableUrl("https://x.test")).toBe(true);
    expect(isRedirectableUrl("http://x.test")).toBe(true);
    expect(isRedirectableUrl("mailto:a@b.test")).toBe(false);
    expect(isRedirectableUrl("javascript:alert(1)")).toBe(false);
    expect(isRedirectableUrl("/relative")).toBe(false);
  });
});
