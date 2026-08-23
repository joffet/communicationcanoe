// Updates one tenant's reside portal URL, used for the per-client
// "View and reply" link in resident emails.
//
// Deliberately its own endpoint rather than reusing the provisioning route:
// provisionTenantInputSchema requires a valid inboundEmailAddress and a
// non-empty twilioNumber, so a caller that only knows the new URL would fail
// validation before reaching the idempotent early-return. A settings save in
// reside knows the routing domain and nothing else.

import { asResideClientUid, createAdminService } from "@communication-canoe/database";
import { z } from "zod";
import { verifyResideSecret } from "@/lib/reside/api-secret";

const inputSchema = z.object({
  // Nullable: clearing the routing domain should clear this too, falling the
  // link back to comm-canoe's global RESIDE_APP_URL.
  resideAppUrl: z.string().url().nullable(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Route segment is reside's client uid, not comm-canoe's tenant uuid.
  const { id: resideClientUid } = await params;

  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminService();
  const tenant = await admin.getTenantByResideClientUid(asResideClientUid(resideClientUid));
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  await admin.updateTenantResideAppUrl(asResideClientUid(resideClientUid), parsed.data.resideAppUrl);

  return Response.json({ ok: true, resideAppUrl: parsed.data.resideAppUrl });
}
