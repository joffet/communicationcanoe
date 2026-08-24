import type { TenantId } from "@communication-canoe/shared/brands";
import { createSignedToken, verifySignedToken } from "./signed-token";

export type ChatSessionPayload = {
  tenantId: TenantId;
  conversationId: string;
  identityId: string;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.CHAT_SESSION_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("CHAT_SESSION_SECRET or INTERNAL_API_SECRET must be set");
  }
  return secret;
}

export function createChatSessionToken(
  payload: Omit<ChatSessionPayload, "exp">,
  ttlMs = Number(process.env.CHAT_SESSION_TTL_MS ?? 604_800_000),
): string {
  return createSignedToken(payload, getSecret(), ttlMs);
}

export function verifyChatSessionToken(token: string): ChatSessionPayload | null {
  return verifySignedToken<ChatSessionPayload>(token, getSecret());
}

export function generateWidgetKey(): string {
  return crypto.randomUUID();
}
