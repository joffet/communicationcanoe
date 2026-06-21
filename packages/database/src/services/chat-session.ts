import { createHmac, timingSafeEqual } from "node:crypto";

export type ChatSessionPayload = {
  tenantId: string;
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

function encodePayload(payload: ChatSessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encoded: string): ChatSessionPayload | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as ChatSessionPayload;
  } catch {
    return null;
  }
}

function sign(encoded: string): string {
  return createHmac("sha256", getSecret()).update(encoded).digest("base64url");
}

export function createChatSessionToken(
  payload: Omit<ChatSessionPayload, "exp">,
  ttlMs = Number(process.env.CHAT_SESSION_TTL_MS ?? 604_800_000),
): string {
  const full: ChatSessionPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const encoded = encodePayload(full);
  return `${encoded}.${sign(encoded)}`;
}

export function verifyChatSessionToken(token: string): ChatSessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const payload = decodePayload(encoded);
  if (!payload || payload.exp < Date.now()) return null;
  return payload;
}

export function generateWidgetKey(): string {
  return crypto.randomUUID();
}
