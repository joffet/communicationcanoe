import { createAdminService, createDomainService } from "@communication-canoe/database";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { findResideActorUserId } from "@/lib/reside/resolve-actor";

export async function GET(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const tenantIdParsed = z.string().uuid().safeParse(url.searchParams.get("tenantId"));
  if (!tenantIdParsed.success) {
    return Response.json({ error: "tenantId must be a valid uuid" }, { status: 400 });
  }
  const viewerResideUserId = url.searchParams.get("viewerResideUserId");
  if (!viewerResideUserId) {
    return Response.json({ error: "viewerResideUserId is required" }, { status: 400 });
  }
  const tenantId = tenantIdParsed.data;

  const admin = createAdminService();
  const tenant = await admin.getTenantById(tenantId);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

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
