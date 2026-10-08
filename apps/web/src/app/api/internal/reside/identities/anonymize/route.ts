import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideAnonymizeSubjectInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";
import { anonymizeResideUser } from "@/lib/reside/anonymize-actor";

/**
 * Reside's anonymizer removing a deleted person from comm-canoe. Idempotent: a
 * repeat call returns zeros. Nothing from the body is logged - it carries a
 * person's contact hashes.
 *
 * An unknown tenant answers 404 with `tenant_not_found` in the body, and reside
 * reads that as done (the building was never provisioned here). Any other 404,
 * such as this route not being deployed yet, it retries.
 */
export async function POST(request: Request) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = resideAnonymizeSubjectInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { tenantId: resideClientUid, subject } = parsed.data;

  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return Response.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // A user subject is the account; the inbox identity its member side wrote
  // under is matched by its contact hashes, which reside sends only when no
  // live member of the building still owns that identity.
  const userAnonymized =
    subject.kind === "user" ? await anonymizeResideUser(resideClientUid, subject.resideUserId) : false;
  const identitiesAnonymized = await createDomainService().anonymizeIdentities(tenant.id, {
    resideResidentId: subject.kind === "resident" ? subject.resideResidentId : undefined,
    contactHashes: subject.contactHashes,
  });

  return Response.json({ identitiesAnonymized, userAnonymized });
}
