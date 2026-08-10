import { timingSafeEqual } from "node:crypto";

/**
 * Verifies the shared secret reside sends on server-to-server calls into comm-canoe.
 * Distinct from INTERNAL_API_SECRET (web <-> realtime-bridge only). Fails closed:
 * an unset secret means no access, not open access.
 */
export function verifyResideSecret(request: Request): boolean {
  const secret = process.env.RESIDE_API_SECRET;
  if (!secret) return false;

  const provided = request.headers.get("x-reside-secret");
  if (!provided) return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
