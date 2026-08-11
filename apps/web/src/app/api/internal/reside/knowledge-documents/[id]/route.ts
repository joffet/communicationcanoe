import { createDomainService } from "@communication-canoe/database";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";

const deleteInputSchema = z.object({ tenantId: z.string().uuid() });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = deleteInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const domain = createDomainService();
  const document = await domain.getDocument(parsed.data.tenantId, id);
  if (!document) {
    return new Response("Unknown document", { status: 404 });
  }

  // document_chunks.document_id has ON DELETE CASCADE - no separate chunk
  // cleanup needed.
  await domain.deleteDocument(parsed.data.tenantId, id);

  return new Response(null, { status: 204 });
}
