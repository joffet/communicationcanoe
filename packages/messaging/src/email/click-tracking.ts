import { createEmailClickToken, isRedirectableUrl } from "./click-tracking-token";

/**
 * Matches the href of an anchor tag, and only an anchor tag.
 *
 * Deliberately narrow. `<img src>` must not match or the open pixel becomes a
 * redirect to itself; `<link href>` in a <head> must not match or a stylesheet
 * reference turns into a click. The capture groups keep everything else about
 * the tag - class, style, target, the rest of the attributes in any order -
 * so a rewritten anchor differs from the original in its href and nothing
 * else.
 */
const ANCHOR_HREF = /(<a\b[^>]*?\shref=)(["'])(.*?)\2/gi;

/** The five entities escapeHtml-style encoders produce. An href in stored
 * HTML is entity-encoded (`&amp;` for a query separator, most commonly), and
 * a URL parser given `&amp;` treats it as a literal parameter name - so the
 * destination has to be decoded before it is signed, or every tracked link
 * with two query parameters redirects to a subtly different page than the one
 * the author linked. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Re-encoded on the way back in, because the result is going into an HTML
 * attribute. Only the two characters that can break out of one - the token is
 * base64url, so it carries no others. */
function encodeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Points every eligible link in an email at the click recorder.
 *
 * Injected at send time only, never written back into `messages.body` - same
 * rule the open pixel follows. The stored body stays the thing the author
 * wrote, so a resend, a reply quote, or a support engineer reading the row
 * sees real destinations rather than a page of redirector URLs.
 *
 * Best-effort throughout: a missing app URL, an unparseable href, a scheme
 * this will not redirect to, all leave the link exactly as it was. Tracking
 * is worth nothing if it can break a send, and a notice whose links stop
 * working is a worse outcome than a notice nobody can measure.
 *
 * Known and accepted: corporate link scanners (Outlook Safe Links, Barracuda,
 * Mimecast) fetch every URL in an inbound email to check it, and each fetch
 * looks exactly like a click. Every click-tracking implementation has this
 * problem and none of them solve it from the outside - treat click counts as
 * an upper bound, not a headcount.
 */
export function withClickTracking(html: string, messageId: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return html;
  const base = appUrl.replace(/\/+$/, "");

  return html.replace(ANCHOR_HREF, (match, prefix: string, quote: string, href: string) => {
    const destination = decodeEntities(href).trim();

    // Leaves mailto:, tel:, relative hrefs, anchors, and anything already
    // pointing at the recorder exactly as they are.
    if (!isRedirectableUrl(destination)) return match;
    if (destination.startsWith(`${base}/api/track/`)) return match;

    try {
      const token = createEmailClickToken(messageId, destination);
      return `${prefix}${quote}${encodeAttribute(`${base}/api/track/click?t=${token}`)}${quote}`;
    } catch {
      // Token minting throws only when the signing secret is unset. A send
      // without tracking beats no send.
      return match;
    }
  });
}
