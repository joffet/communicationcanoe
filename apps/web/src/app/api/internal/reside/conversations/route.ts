import { asResideClientUid,
  createAdminService,
  createDomainService,
  toResideConversation, } from "@communication-canoe/database";
import { CONVERSATION_STATUSES } from "@communication-canoe/shared/constants";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { findResideActorUserId } from "@/lib/reside/resolve-actor";

export async function GET(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  // This is reside's client uid, which may be a slug - not comm-canoe's tenant
  // uuid. It is only ever compared against the text reside_client_uid column,
  // so no uuid shape check applies (and none is needed to keep it out of a
  // uuid comparison, which was the original reason for validating here).
  const resideClientUidParsed = z.string().min(1).transform(asResideClientUid).safeParse(url.searchParams.get("tenantId"));
  if (!resideClientUidParsed.success) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }
  const resideClientUid = resideClientUidParsed.data;

  const statusParam = url.searchParams.get("status");
  const status = statusParam && (CONVERSATION_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as (typeof CONVERSATION_STATUSES)[number])
    : undefined;
  const assigneeUserId = url.searchParams.get("assigneeUserId") ?? undefined;
  const tagId = url.searchParams.get("tagId") ?? undefined;
  const viewerResideUserId = url.searchParams.get("viewerResideUserId") ?? undefined;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  const admin = createAdminService();
  const domain = createDomainService();

  const tenant = await admin.getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  let conversations = await domain.getConversationsForTenant(tenantId, { status, limit });

  // assigneeUserId/tagId aren't supported by the underlying query (which only
  // filters on the single-assignee assigned_team_id column) - filter the
  // already-tenant-scoped page in memory instead of extending that query,
  // since admin inbox volumes here are small.
  if (assigneeUserId) {
    conversations = conversations.filter((c) => c.assignees.some((a) => a.userId === assigneeUserId));
  }
  if (tagId) {
    conversations = conversations.filter((c) => c.tags.some((t) => t.id === tagId));
  }

  // viewerResideUserId is a lookup only, never a create - a reside admin
  // requesting their own dashboard/inbox list who has never touched a
  // conversation simply sees viewer_is_relevant: false on everything.
  if (!viewerResideUserId) {
    return Response.json({ conversations: conversations.map(toResideConversation) });
  }
  const viewerUserId = await findResideActorUserId(viewerResideUserId);
  if (!viewerUserId) {
    const unresolved = conversations.map((c) => ({
      ...toResideConversation(c),
      viewer_is_relevant: false,
      viewer_has_unread: false,
      viewer_last_read_at: null,
    }));
    return Response.json({ conversations: unresolved });
  }

  const viewerStates = await domain.getViewerConversationStates(conversations, viewerUserId);
  const enriched = conversations.map((c) => ({
    ...toResideConversation(c),
    ...(viewerStates.get(c.id) ?? { viewer_is_relevant: false, viewer_has_unread: false, viewer_last_read_at: null }),
  }));

  return Response.json({ conversations: enriched });
}
