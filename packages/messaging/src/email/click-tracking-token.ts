import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailClickTokenPayload = {
  messageId: string;
  /** The destination, inside the signature.
   *
   * This is the whole security design. The obvious shape for a click
   * redirector is `/api/track/click?t=<signed message id>&u=<url>`, and it is
   * an open redirect: the signature covers the message id, nothing covers the
   * url, so anyone holding one of these links can point it anywhere and send
   * it on under this domain's name. Signing the pair means a tampered
   * destination fails verification, and there is no unsigned parameter to
   * tamper with in the first place. */
  url: string;
  exp: number;
};

/** Same window the open pixel uses. A notice can be read - and its links
 * followed - long after it was sent. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.CHAT_SESSION_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("CHAT_SESSION_SECRET or INTERNAL_API_SECRET must be set");
  }
  return secret;
}

function sign(encoded: string): string {
  return createHmac("sha256", getSecret()).update(encoded).digest("base64url");
}

/** Same compact-token shape as open-tracking-token.ts: base64url(payload) +
 * "." + base64url(HMAC_SHA256(payload)). Stateless to verify, so a click
 * redirect costs no database round trip before it knows where to send
 * somebody. */
export function createEmailClickToken(
  messageId: string,
  url: string,
  ttlMs = DEFAULT_TTL_MS,
): string {
  const payload: EmailClickTokenPayload = { messageId, url, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyEmailClickToken(token: string): EmailClickTokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as EmailClickTokenPayload;
    if (!payload.messageId || typeof payload.exp !== "number" || payload.exp < Date.now()) {
      return null;
    }
    // A signature over a payload with no url is still a valid signature, so
    // the shape is checked as well as the signature - and only a destination
    // this service would have minted is honoured, which is what stops a
    // signed token being replayed with a javascript: or data: target.
    if (!isRedirectableUrl(payload.url)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Whether a destination is one worth rewriting, and later worth redirecting
 * to.
 *
 * http and https only. `mailto:` and `tel:` are ordinary in a building notice
 * and must pass through untouched rather than becoming redirects - a rewritten
 * mailto is a broken link. `javascript:` and `data:` are the reason this is an
 * allowlist rather than a blocklist: a notice body is admin-authored, but it
 * reaches here as a string, and a redirector that will emit any scheme it is
 * given is a cross-site scripting primitive with a trusted domain in front of
 * it.
 */
export function isRedirectableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    // Relative hrefs land here. An email has no base to resolve them against,
    // so they are already broken - leaving them alone is the honest outcome.
    return false;
  }
}
