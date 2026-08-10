import { createHmac, timingSafeEqual } from "node:crypto";

export type ResideSsoClaims = {
  externalUserId: string;
  email: string;
  name: string;
  resideClientUid: string;
  role?: "admin" | "user" | "super";
  iat: number;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.RESIDE_SSO_SIGNING_SECRET;
  if (!secret) throw new Error("RESIDE_SSO_SIGNING_SECRET must be set");
  return secret;
}

function sign(encoded: string): string {
  return createHmac("sha256", getSecret()).update(encoded).digest("base64url");
}

/**
 * Verifies a reside-issued SSO token: base64url(claims) + "." + base64url(HMAC_SHA256(claims)).
 * Same shape as chat-session.ts's token, kept behind this single function so a future
 * JWT/public-key implementation is a drop-in replacement.
 */
export function verifyResideSsoToken(token: string): ResideSsoClaims | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let claims: ResideSsoClaims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!claims.externalUserId || !claims.email || !claims.resideClientUid) return null;
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;

  return claims;
}
