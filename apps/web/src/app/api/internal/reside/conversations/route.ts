import { createAdminService, createDomainService } from "@communication-canoe/database";
import { CONVERSATION_STATUSES } from "@communication-canoe/shared/constants";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";

export async function GET(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const tenantIdParsed = z.string().uuid().safeParse(tenantIdParam);
  if (!tenantIdParsed.success) {
    return Response.json({ error: "tenantId must be a valid uuid" }, { status: 400 });
  }
  const tenantId = tenantIdParsed.data;

  const statusParam = url.searchParams.get("status");
  const status = statusParam && (CONVERSATION_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as (typeof CONVERSATION_STATUSES)[number])
    : undefined;
  const assigneeUserId = url.searchParams.get("assigneeUserId") ?? undefined;
  const tagId = url.searchParams.get("tagId") ?? undefined;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  const admin = createAdminService();
  const domain = createDomainService();

  const tenant = await admin.getTenantById(tenantId);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  let conversations = await domain.getConversationsForTenant(tenantId, { status, limit });

  // assigneeUserId/tagId aren't supported by the underlying query (which only
  // filters on the single-assignee assigned_team_id column) - filter the
  // already-tenant-scoped page in memory instead of extending that query,
  // since admin inbox volumes here are small.
  if (assigneeUserId) {
    conversations = conversations.filter((c) => c.assignees.some((a) => a.user_id === assigneeUserId));
  }
  if (tagId) {
    conversations = conversations.filter((c) => c.tags.some((t) => t.id === tagId));
  }

  return Response.json({ conversations });
}
