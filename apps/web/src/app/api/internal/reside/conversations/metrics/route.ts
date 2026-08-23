import { asResideClientUid, createAdminService, createDomainService } from "@communication-canoe/database";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { findResideActorUserId } from "@/lib/reside/resolve-actor";

export async function GET(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  // reside's client uid (may be a slug), resolved to the internal tenant id below.
  const resideClientUidParsed = z.string().min(1).transform(asResideClientUid).safeParse(url.searchParams.get("tenantId"));
  if (!resideClientUidParsed.success) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }
  const viewerResideUserId = url.searchParams.get("viewerResideUserId");
  if (!viewerResideUserId) {
    return Response.json({ error: "viewerResideUserId is required" }, { status: 400 });
  }
  const resideClientUid = resideClientUidParsed.data;

  const admin = createAdminService();
  const tenant = await admin.getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  // Lookup only, never creates - a viewer with no comm-canoe user yet has
  // never touched any conversation, so their counts are trivially zero.
  const viewerUserId = await findResideActorUserId(viewerResideUserId);
  if (!viewerUserId) {
    return Response.json({ unread_relevant_count: 0, open_relevant_count: 0 });
  }

  const domain = createDomainService();
  const metrics = await domain.getConversationMetricsForViewer(tenantId, viewerUserId);

  return Response.json(metrics);
}
