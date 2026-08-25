import { createEmailClickToken, isRedirectableUrl } from "./click-tracking-token";

/**
 * The query parameter an on-domain tracked link carries.
 *
 * Deliberately not named `utm_*` or anything else on Safari's and Firefox's
 * link-tracking strip lists - those lists are matched by name, and a stripped
 * parameter is a click nobody records.
 */
export const CLICK_PARAM = "ccm";

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

/** Host without a leading `www.`, lowercased, or null for anything unparseable.
 *
 * `www.` is folded because a notice author writing the building's address with
 * the prefix means the same site the tenant's reside host names without it,
 * and the cost of getting that wrong is silent: the link is wrapped, and a
 * wrapped link can never open the mobile app. */
function registrableHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Removes any existing click parameter from a destination.
 *
 * Runs before signing, so the recorded URL is the one the author wrote rather
 * than one carrying somebody else's stale token - an admin who pastes a link
 * out of a tracked email they received would otherwise attribute every
 * resident's click to their own message row. It also makes the parameter path
 * idempotent, which is the guarantee the redirect path gets from its
 * "already points at the recorder" check.
 */
function stripClickParam(url: string): string {
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);

  const queryAt = base.indexOf("?");
  if (queryAt === -1) return url;

  const params = base
    .slice(queryAt + 1)
    .split("&")
    .filter((part) => part !== "" && part !== CLICK_PARAM && !part.startsWith(`${CLICK_PARAM}=`));

  return `${base.slice(0, queryAt)}${params.length ? `?${params.join("&")}` : ""}${fragment}`;
}

/** Appends the token by string surgery rather than through `new URL`, whose
 * serializer normalises percent-encoding and adds trailing slashes. The
 * destination must reach the reader exactly as the author wrote it; the only
 * difference is one more parameter, before any fragment. */
function withClickParam(destination: string, token: string): string {
  const hashAt = destination.indexOf("#");
  const base = hashAt === -1 ? destination : destination.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : destination.slice(hashAt);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${CLICK_PARAM}=${token}${fragment}`;
}

/**
 * Makes every eligible link in an email measurable, by one of two mechanisms
 * chosen on who owns the destination.
 *
 * **A link to the tenant's own reside host keeps its URL** and carries the
 * token as a query parameter; reside's landing page reports it. **Everything
 * else** is pointed at the click recorder, which records and redirects.
 *
 * The split exists because wrapping is the wrong shape for a link we control:
 *
 * - iOS and Android match app links against the URL that was *tapped* and do
 *   not re-evaluate after a redirect, so a wrapped link can never open the
 *   reside mobile app - no matter what either app declares.
 * - A wrapped link stops working when its token expires, when this service is
 *   unreachable, or when the signing secret rotates. A parameter degrades to
 *   an unattributed click instead; the reader still arrives.
 * - The redirect waits on a reside round trip before the reader's page begins
 *   to load. The parameter is reported after it has.
 *
 * What does not change is the token. It is the same `createEmailClickToken`
 * either way, still signing the destination alongside the message id, so the
 * URL a click is recorded against comes from the signature rather than from
 * whatever the browser reports.
 *
 * Injected at send time only, never written back into `messages.body` - same
 * rule the open pixel follows. The stored body stays the thing the author
 * wrote, so a resend, a reply quote, or a support engineer reading the row
 * sees real destinations.
 *
 * Best-effort throughout: a missing app URL, an unparseable href, a scheme
 * this will not redirect to, all leave the link exactly as it was. Tracking
 * is worth nothing if it can break a send, and a notice whose links stop
 * working is a worse outcome than a notice nobody can measure.
 *
 * Known and accepted for the redirect half: corporate link scanners (Outlook
 * Safe Links, Barracuda, Mimecast) fetch every URL in an inbound email to
 * check it, and each fetch looks exactly like a click. The parameter half does
 * not have this problem, because a scanner fetching the page does not run the
 * script that reports it - so on-domain counts are people and off-domain
 * counts remain an upper bound. Do not add the two together and call the
 * result a headcount.
 */
export function withClickTracking(
  html: string,
  messageId: string,
  /** This tenant's own reside host, from `tenants.reside_app_url` - the same
   * value withMemberPortalLink prefers. Links to it are the ones that get a
   * parameter. Absent, every link is wrapped, which is what every send did
   * before the parameter existed. */
  resideAppUrl?: string | null,
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return html;
  const base = appUrl.replace(/\/+$/, "");
  const ownHost = registrableHost(resideAppUrl || process.env.RESIDE_APP_URL || "");

  return html.replace(ANCHOR_HREF, (match, prefix: string, quote: string, href: string) => {
    const destination = decodeEntities(href).trim();

    // Leaves mailto:, tel:, relative hrefs, anchors, and anything already
    // pointing at the recorder exactly as they are.
    if (!isRedirectableUrl(destination)) return match;
    if (destination.startsWith(`${base}/api/track/`)) return match;

    try {
      const onOwnHost = ownHost !== null && registrableHost(destination) === ownHost;
      if (onOwnHost) {
        const clean = stripClickParam(destination);
        const token = createEmailClickToken(messageId, clean);
        return `${prefix}${quote}${encodeAttribute(withClickParam(clean, token))}${quote}`;
      }

      const token = createEmailClickToken(messageId, destination);
      return `${prefix}${quote}${encodeAttribute(`${base}/api/track/click?t=${token}`)}${quote}`;
    } catch {
      // Token minting throws only when the signing secret is unset. A send
      // without tracking beats no send.
      return match;
    }
  });
}
