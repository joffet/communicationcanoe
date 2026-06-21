import { createDomainService } from "@communication-canoe/database";

function verifyInternalSecret(request: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return true;
  return request.headers.get("x-internal-secret") === secret;
}

export { verifyInternalSecret };

export function getBridgeUrl(): string {
  return (
    process.env.REALTIME_BRIDGE_URL ??
    process.env.VOICE_BRIDGE_URL ??
    "http://localhost:3001"
  );
}

export async function notifyBridgeHandoffJoin(payload: {
  conversationId: string;
  tenantId: string;
  agentUserId: string;
  agentName?: string;
}) {
  const res = await fetch(`${getBridgeUrl()}/internal/handoff-join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function notifyBridgeAgentMessage(payload: {
  conversationId: string;
  agentUserId: string;
  agentName?: string;
  body: string;
  relayOnly?: boolean;
}) {
  const res = await fetch(`${getBridgeUrl()}/internal/agent-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function getOnCallUsers(tenantId: string, teamId?: string | null) {
  const domain = createDomainService();
  return domain.getOnCallUsers(tenantId, teamId);
}
