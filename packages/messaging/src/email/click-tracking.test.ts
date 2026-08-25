import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { withClickTracking } from "./click-tracking";
import {
  createEmailClickToken,
  isRedirectableUrl,
  readEmailClickToken,
  verifyEmailClickToken,
} from "./click-tracking-token";

const APP = "https://canoe.test";
const RESIDE = "https://onecardiff.ca";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP;
  process.env.CHAT_SESSION_SECRET = "test-secret";
  // Every test below that does not pass a reside host expects the wrap-
  // everything behaviour, and would otherwise depend on whatever the
  // developer running it happens to have exported.
  delete process.env.RESIDE_APP_URL;
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

describe("withClickTracking, on the tenant's own host", () => {
  /** The token carried by a parameter rather than by the recorder's URL. */
  function paramTokenOf(html: string): string | null {
    const match = /(?:[?&]|&amp;)ccm=([^"'&]+)/.exec(html);
    return match ? match[1] : null;
  }

  function paramDestinationOf(html: string): string | null {
    const token = paramTokenOf(html);
    return token ? (verifyEmailClickToken(token)?.url ?? null) : null;
  }

  /**
   * The reason the split exists. iOS and Android match app links against the
   * URL that was tapped and do not re-evaluate after a redirect, so a link
   * wrapped in this service's domain can never open the reside mobile app.
   */
  it("keeps the destination and appends the token as a parameter", () => {
    const html = withClickTracking(
      '<a href="https://onecardiff.ca/member/notices/abc">Read it</a>',
      "msg-1",
      RESIDE,
    );

    expect(html).not.toContain("/api/track/click");
    expect(html).toContain('href="https://onecardiff.ca/member/notices/abc?ccm=');
    expect(html).toContain(">Read it</a>");
  });

  /* The recorded URL comes from the signature, not from whatever the
   * reporting page claims - so the parameter must not be inside it. */
  it("signs the destination without the parameter it is about to add", () => {
    const html = withClickTracking('<a href="https://onecardiff.ca/p">x</a>', "msg-1", RESIDE);
    expect(paramDestinationOf(html)).toBe("https://onecardiff.ca/p");
  });

  it("wraps an off-domain link in the same email", () => {
    const html = withClickTracking(
      '<a href="https://onecardiff.ca/p">ours</a><a href="https://city.test/bylaw">theirs</a>',
      "msg-1",
      RESIDE,
    );

    expect(html).toContain('href="https://onecardiff.ca/p?ccm=');
    expect(html).toContain(`${APP}/api/track/click?t=`);
    expect(destinationOf(html)).toBe("https://city.test/bylaw");
  });

  /* A notice author writing the building's address with the prefix means the
   * same site. Getting this wrong is silent: the link is wrapped, and a
   * wrapped link cannot open the app. */
  it("treats www as the same host", () => {
    const html = withClickTracking('<a href="https://www.onecardiff.ca/p">x</a>', "msg-1", RESIDE);
    expect(html).not.toContain("/api/track/click");
    expect(html).toContain("?ccm=");
  });

  it("joins an existing query with & and stays before the fragment", () => {
    const query = withClickTracking('<a href="https://onecardiff.ca/p?a=1">x</a>', "msg-1", RESIDE);
    // Encoded, because it is going into an HTML attribute.
    expect(query).toContain("a=1&amp;ccm=");

    const fragment = withClickTracking(
      '<a href="https://onecardiff.ca/p#section">x</a>',
      "msg-1",
      RESIDE,
    );
    expect(fragment).toMatch(/href="https:\/\/onecardiff\.ca\/p\?ccm=[^"]+#section"/);
  });

  /**
   * An admin who pastes a link out of a tracked email they received would
   * otherwise send every resident a URL carrying their own message id, and
   * `URLSearchParams.get` returns the first of two - so every click in the
   * building would land on the admin's row.
   */
  it("replaces an existing parameter rather than appending a second", () => {
    const once = withClickTracking('<a href="https://onecardiff.ca/p">x</a>', "msg-1", RESIDE);
    const twice = withClickTracking(once, "msg-2", RESIDE);

    expect(twice.match(/ccm=/g)).toHaveLength(1);
    expect(verifyEmailClickToken(paramTokenOf(twice)!)).toMatchObject({
      messageId: "msg-2",
      url: "https://onecardiff.ca/p",
    });
  });

  it("keeps the other parameters when it replaces one", () => {
    const html = withClickTracking(
      '<a href="https://onecardiff.ca/p?a=1&amp;ccm=stale&amp;b=2">x</a>',
      "msg-1",
      RESIDE,
    );
    expect(html).not.toContain("ccm=stale");
    expect(paramDestinationOf(html)).toBe("https://onecardiff.ca/p?a=1&b=2");
  });

  it("decodes entities before signing, like the wrapped path", () => {
    const html = withClickTracking(
      '<a href="https://onecardiff.ca/p?a=1&amp;b=2">x</a>',
      "msg-1",
      RESIDE,
    );
    expect(paramDestinationOf(html)).toBe("https://onecardiff.ca/p?a=1&b=2");
  });

  /* Every send did this before the parameter existed, and a tenant with no
   * routing domain configured still does. */
  it("wraps everything when the tenant has no reside host", () => {
    const html = withClickTracking('<a href="https://onecardiff.ca/p">x</a>', "msg-1", null);
    expect(html).toContain(`${APP}/api/track/click?t=`);
    expect(destinationOf(html)).toBe("https://onecardiff.ca/p");
  });

  it("falls back to the RESIDE_APP_URL env var", () => {
    process.env.RESIDE_APP_URL = RESIDE;
    const html = withClickTracking('<a href="https://onecardiff.ca/p">x</a>', "msg-1");
    expect(html).not.toContain("/api/track/click");
  });
});

/** The cross-repo seam: reside gates on a token shape it cannot verify. */
describe("the token reside receives", () => {
  it("passes reside's shape gate and verifies here", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://canoe.test";
    process.env.CHAT_SESSION_SECRET = "test-secret";

    const html = withClickTracking(
      '<a href="https://onecardiff.ca/member/notices/abc?a=1">Read</a>',
      "msg-1",
      "https://onecardiff.ca",
    );

    // Exactly what a browser hands reside: the attribute, entity-decoded by
    // the HTML parser, then read back through URLSearchParams.
    const href = /href="([^"]+)"/.exec(html)![1].replace(/&amp;/g, "&");
    const token = new URL(href).searchParams.get("ccm")!;

    // Copied from reside apps/web/src/app/api/track/click-beacon/route.ts.
    const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
    expect(TOKEN_SHAPE.test(token)).toBe(true);
    expect(token.length).toBeLessThan(4096);

    expect(verifyEmailClickToken(token)).toMatchObject({
      messageId: "msg-1",
      url: "https://onecardiff.ca/member/notices/abc?a=1",
    });
  });
});

/**
 * Expiry gates the write, not the read.
 *
 * Refusing on age meant a resident opening a five-week-old email got a bare
 * 404 for a page that still exists and that they are entitled to see. The
 * destination is inside the signature, so sending them there is safe however
 * old the token is - what stays bounded is recording a click on the strength
 * of one.
 *
 * Everything below is the same set of forgeries the strict path refuses. The
 * risk in relaxing a gate is relaxing the wrong one.
 */
describe("reading an expired click token", () => {
  const expired = () => createEmailClickToken("msg-1", "https://x.test/go", -1);

  it("returns the destination, marked expired", () => {
    expect(readEmailClickToken(expired())).toEqual({
      payload: expect.objectContaining({ messageId: "msg-1", url: "https://x.test/go" }),
      expired: true,
    });
  });

  it("marks a current token unexpired", () => {
    const reading = readEmailClickToken(createEmailClickToken("msg-1", "https://x.test/go"));
    expect(reading?.expired).toBe(false);
  });

  /* The strict path is what the beacon uses: nobody is stranded by a refusal
   * there, because the page has already loaded. */
  it("is still refused by the strict path", () => {
    expect(verifyEmailClickToken(expired())).toBeNull();
  });

  it("still refuses a tampered signature", () => {
    expect(readEmailClickToken(`${expired().split(".")[0]}.deadbeef`)).toBeNull();
  });

  it("still refuses a swapped destination", () => {
    const token = expired();
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    const forged = Buffer.from(
      JSON.stringify({ ...payload, url: "https://evil.test" }),
    ).toString("base64url");
    expect(readEmailClickToken(`${forged}.${token.split(".")[1]}`)).toBeNull();
  });

  it("still refuses an unredirectable scheme", () => {
    expect(readEmailClickToken(createEmailClickToken("msg-1", "javascript:alert(1)", -1))).toBeNull();
  });

  /* "No expiry I can read" is not the same claim as "an expiry that has
   * passed", and only the second is safe to wave through.
   *
   * The payload has to be genuinely signed for this to test anything. Pairing
   * a malformed payload with some other token's signature is refused by the
   * signature check long before the exp is read, and the test would pass with
   * the exp check deleted. */
  it("refuses a malformed or missing exp", () => {
    for (const exp of [undefined, "soon", null]) {
      const encoded = Buffer.from(
        JSON.stringify({ messageId: "msg-1", url: "https://x.test/go", exp }),
      ).toString("base64url");
      const signature = createHmac("sha256", process.env.CHAT_SESSION_SECRET!)
        .update(encoded)
        .digest("base64url");

      // The signature is real: only the payload shape is wrong.
      expect(readEmailClickToken(`${encoded}.${signature}`)).toBeNull();
      // ...and the control, so a change to how tokens are signed shows up
      // here as a failure rather than as a test that stopped testing.
      const wellFormed = Buffer.from(
        JSON.stringify({ messageId: "msg-1", url: "https://x.test/go", exp: Date.now() + 1000 }),
      ).toString("base64url");
      const goodSignature = createHmac("sha256", process.env.CHAT_SESSION_SECRET!)
        .update(wellFormed)
        .digest("base64url");
      expect(readEmailClickToken(`${wellFormed}.${goodSignature}`)).not.toBeNull();
    }
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
