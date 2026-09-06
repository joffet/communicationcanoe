import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideRenameIdentityInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideRenameIdentityInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId: resideClientUid, resideResidentId, email, phone } = parsed.data;

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }
  const tenantId = tenant.id;

  const outcome = await createDomainService().renameIdentity(tenantId, {
    resideResidentId,
    email,
    phone,
  });

  // No identity matched by resideResidentId, old email, or old phone - a
  // resident who has never been messaged has no identity yet, which is an
  // expected empty case for the caller, not an error.
  if (!outcome) {
    return Response.json({ error: "No identity found for this resident" }, { status: 404 });
  }

  return Response.json({ result: outcome.result });
}
