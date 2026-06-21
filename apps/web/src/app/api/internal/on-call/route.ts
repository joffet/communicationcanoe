import { verifyInternalSecret, getOnCallUsers } from "@/lib/bridge/internal";

export async function GET(request: Request) {
  if (!verifyInternalSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const teamId = url.searchParams.get("teamId");

  if (!tenantId) {
    return new Response("Missing tenantId", { status: 400 });
  }

  const users = await getOnCallUsers(tenantId, teamId);
  return Response.json({ users });
}
