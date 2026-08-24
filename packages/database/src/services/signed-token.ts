import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `base64url(payload).base64url(hmac)`, the shape both of this codebase's
 * bearer tokens use - the visitor's chat session token and the dashboard
 * socket token. They differ in payload, secret and lifetime, and in nothing
 * else, so the algorithm lives here once rather than being reimplemented per
 * token with its own chance of skipping the constant-time compare.
 *
 * Not a JWT: no algorithm field, so there is no `alg` to confuse and only one
 * way to verify these.
 */
export type SignedTokenPayload = { exp: number };

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function createSignedToken<T extends object>(
  payload: T,
  secret: string,
  ttlMs: number,
): string {
  const full = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySignedToken<T extends SignedTokenPayload>(
  token: string,
  secret: string,
): T | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }

  if (typeof payload?.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}
