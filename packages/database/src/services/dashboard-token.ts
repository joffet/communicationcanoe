import type { TenantId } from "@communication-canoe/shared/brands";
import { createSignedToken, verifySignedToken } from "./signed-token";

/**
 * What the bridge knows about a dashboard socket. `tenantId` is the tenant
 * whose inbox the agent has open, already checked against their memberships by
 * the route that minted this (see apps/web/src/app/api/realtime/token); the
 * bridge treats it as authoritative and scopes every subscription to it.
 */
export type DashboardTokenPayload = {
  userId: string;
  /** Display name, so presence does not need a second lookup per viewer. */
  name: string;
  tenantId: TenantId;
  exp: number;
};

/**
 * Short by design. The token authorizes the WebSocket handshake and nothing
 * after it - once the socket is open it stays open on its own, and a reconnect
 * fetches a fresh one - so the window in which a leaked token is useful should
 * be about as long as it takes to connect.
 */
const TOKEN_TTL_MS = 60_000;

function getSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_API_SECRET must be set to issue dashboard tokens");
  }
  return secret;
}

export function createDashboardToken(
  payload: Omit<DashboardTokenPayload, "exp">,
  ttlMs = TOKEN_TTL_MS,
): string {
  return createSignedToken(payload, getSecret(), ttlMs);
}

export function verifyDashboardToken(token: string): DashboardTokenPayload | null {
  return verifySignedToken<DashboardTokenPayload>(token, getSecret());
}
