import {
  asResideClientUid,
  createAdminService,
  createDomainService,
} from "@communication-canoe/database";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";

/**
 * `.min(1)`, not `.uuid()`. reside posts its own client uid as `tenantId` here
 * (see deleteCommCanoeKnowledgeDocument on its side), and that uid is the slug
 * "cardiff" for the production client - so the uuid check this schema used to
 * carry rejected the only client that matters with a 400 before the handler
 * ran. Same rule as every other reside-facing schema in
 * packages/shared/src/schemas; this one was declared locally and missed it.
 */
const deleteInputSchema = z.object({ tenantId: z.string().min(1) });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = deleteInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve reside's uid to this side's tenant uuid before any scoped read or
  // write - `parsed.data.tenantId` is the uid and must never reach a tenant_id
  // comparison directly. Matches every other route under internal/reside.
  const tenant = await createAdminService().getTenantByResideClientUid(
    asResideClientUid(parsed.data.tenantId),
  );
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  const domain = createDomainService();
  const document = await domain.getDocument(tenant.id, id);
  if (!document) {
    return new Response("Unknown document", { status: 404 });
  }

  // document_chunks.document_id has ON DELETE CASCADE - no separate chunk
  // cleanup needed.
  await domain.deleteDocument(tenant.id, id);

  return new Response(null, { status: 204 });
}
