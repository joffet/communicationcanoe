import { createDashboardToken, isTenantId } from "@communication-canoe/database";
import { requireTenantMembership } from "@/lib/auth/access";

/**
 * Mints the credential for the dashboard's socket to realtime-bridge.
 *
 * The bridge has no session of its own - it never sees a Better Auth cookie -
 * so membership is checked here, once, and the answer travels as a short-lived
 * signed token the bridge can verify with the secret the two already share.
 * Everything the socket is allowed to see follows from the tenant in it.
 *
 * The socket URL comes back with the token so the browser needs no public env
 * var for it: this is the only page in the app that opens one, and it always
 * asks here first.
 */
export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId || !isTenantId(tenantId)) {
    return new Response("Bad request", { status: 400 });
  }

  const access = await requireTenantMembership(tenantId);
  if (!access) return new Response("Not found", { status: 404 });

  const url = process.env.REALTIME_BRIDGE_PUBLIC_WS_URL;
  if (!url) return new Response("Realtime not configured", { status: 503 });

  const token = createDashboardToken({
    userId: access.session.user.id,
    name:
      access.session.user.name ??
      access.session.user.email?.split("@")[0] ??
      "Agent",
    tenantId,
  });

  return Response.json({ token, url: `${url.replace(/\/$/, "")}/dashboard` });
}
