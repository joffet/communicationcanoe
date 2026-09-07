import { describe, expect, it } from "vitest";
import { RESIDE_UNSUBSCRIBE_PLACEHOLDER } from "@communication-canoe/shared/schemas";
import { applyUnsubscribePlaceholder } from "./unsubscribe-placeholder";

const BODY = `<p>Notice</p><p><a href="${RESIDE_UNSUBSCRIBE_PLACEHOLDER}">Stop these</a></p>`;

describe("per-recipient unsubscribe substitution", () => {
  it("puts this recipient's own link in", () => {
    const out = applyUnsubscribePlaceholder(BODY, "https://onecardiff.ca/n/a?t=abc");
    expect(out).toContain('href="https://onecardiff.ca/n/a?t=abc"');
    expect(out).not.toContain(RESIDE_UNSUBSCRIBE_PLACEHOLDER);
  });

  it("removes the anchor entirely for a recipient with no link", () => {
    // Leaving href="" behind is worse than removing it: in a mail client an
    // empty href is a live link back to the message itself.
    const out = applyUnsubscribePlaceholder(BODY, null);
    expect(out).not.toContain(RESIDE_UNSUBSCRIBE_PLACEHOLDER);
    expect(out).not.toContain('href=""');
    expect(out).not.toContain("Stop these");
    expect(out).toContain("<p>Notice</p>");
  });

  it("never leaves the literal token in a sent body", () => {
    // The failure this guards is only ever noticed by a resident, and by then
    // it has gone to everyone.
    for (const url of ["https://x.test/a", undefined, null, ""]) {
      expect(applyUnsubscribePlaceholder(BODY, url)).not.toContain(RESIDE_UNSUBSCRIBE_PLACEHOLDER);
    }
  });

  it("survives a URL containing $& , which String.replace would mangle", () => {
    // split/join rather than replace: `$&` in the replacement is a
    // backreference, so a token containing it would paste the match back in.
    const url = "https://onecardiff.ca/n/a?t=ab$&cd";
    expect(applyUnsubscribePlaceholder(BODY, url)).toContain(`href="${url}"`);
  });

  it("leaves a body that never asked for one alone", () => {
    const plain = "<p>Just a notice</p>";
    expect(applyUnsubscribePlaceholder(plain, "https://x.test/a")).toBe(plain);
  });

  it("substitutes every occurrence, not just the first", () => {
    const twice = `${BODY}${BODY}`;
    const out = applyUnsubscribePlaceholder(twice, "https://x.test/a");
    expect(out.match(/https:\/\/x\.test\/a/g)).toHaveLength(2);
  });
});
