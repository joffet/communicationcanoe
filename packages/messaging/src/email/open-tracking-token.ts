import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailOpenTokenPayload = {
  messageId: string;
  exp: number;
};

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days - notices/notifications can be opened well after send

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

/** Same compact-token shape as chat-session.ts/reside-sso.ts:
 * base64url(payload) + "." + base64url(HMAC_SHA256(payload)). Stateless to
 * verify - no DB round-trip needed before deciding whether to record an open. */
export function createEmailOpenToken(messageId: string, ttlMs = DEFAULT_TTL_MS): string {
  const payload: EmailOpenTokenPayload = { messageId, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyEmailOpenToken(token: string): EmailOpenTokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EmailOpenTokenPayload;
    if (!payload.messageId || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
