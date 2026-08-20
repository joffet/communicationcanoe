import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideCreateKnowledgeDocumentInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

// Fallbacks for a tenant that's never had tenant_settings written -
// getTenantSettings is a plain select, not an upsert, matching the same
// convention as tenants/[id]/settings/route.ts's DEFAULT_* constants.
const DEFAULT_MAX_KNOWLEDGE_DOCUMENTS = 50;
const DEFAULT_MAX_KNOWLEDGE_CHUNKS = 5000;

export async function GET(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const resideClientUid = new URL(request.url).searchParams.get("tenantId");
  if (!resideClientUid) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  const documents = await createDomainService().listDocumentsForTenant(tenant.id);
  return Response.json({ documents });
}

export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideCreateKnowledgeDocumentInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { tenantId: resideClientUid, filename, contentText, extractor, pageCount, uploadedBy } = parsed.data;

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  // Re-checked here even though reside enforces the same cap before calling -
  // defense in depth for a new, first-of-its-kind unattended-cost surface
  // (embedding-API spend driven by a background worker, not a per-click AI
  // cost like suggestReply/tone review).
  const domain = createDomainService();
  const settings = await domain.getTenantSettings(tenantId);
  const maxDocuments = settings?.maxKnowledgeDocuments ?? DEFAULT_MAX_KNOWLEDGE_DOCUMENTS;
  const maxChunks = settings?.maxKnowledgeChunks ?? DEFAULT_MAX_KNOWLEDGE_CHUNKS;

  const [documentCount, chunkCount] = await Promise.all([
    domain.countTenantDocuments(tenantId),
    domain.countTenantChunks(tenantId),
  ]);

  if (documentCount >= maxDocuments) {
    return Response.json(
      { error: `Tenant has reached its knowledge document limit (${maxDocuments})` },
      { status: 409 }
    );
  }
  if (chunkCount >= maxChunks) {
    return Response.json({ error: `Tenant has reached its knowledge chunk limit (${maxChunks})` }, { status: 409 });
  }

  const document = await domain.createDocument({
    tenantId,
    filename,
    contentText,
    extractor,
    pageCount,
    uploadedBy,
  });

  return Response.json({ documentId: document.id });
}
