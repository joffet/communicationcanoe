import { createAdminService, createDomainService } from "@communication-canoe/database";
import { resideUpdateTenantSettingsInputSchema } from "@communication-canoe/shared/schemas";
import { verifyResideSecret } from "@/lib/reside/api-secret";

// Column defaults from the tenant_settings schema - used when no row exists
// yet (getTenantSettings is a plain select, not an upsert, so a tenant that's
// never had settings written returns null here).
const DEFAULT_RESPONSE_WINDOW_MINUTES = 60;
const DEFAULT_EXTERNAL_SEND_DELAY_SECONDS = 60;
const DEFAULT_CONVERSATION_STALENESS_MINUTES = 1440;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Route segment is reside's client uid, not comm-canoe's tenant uuid.
  const { id: resideClientUid } = await params;
  const tenant = await createAdminService().getTenantByResideClientUid(resideClientUid);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  const settings = await createDomainService().getTenantSettings(tenant.id);
  const faqRaw = settings?.faq_snippets;
  const faqSnippets = Array.isArray(faqRaw)
    ? (faqRaw as Array<{ q?: string; a?: string }>).map((f) => ({ q: f.q ?? "", a: f.a ?? "" }))
    : [];

  return Response.json({
    settings: {
      defaultResponseWindowMinutes: settings?.default_response_window_minutes ?? DEFAULT_RESPONSE_WINDOW_MINUTES,
      externalSendDelaySeconds: settings?.external_send_delay_seconds ?? DEFAULT_EXTERNAL_SEND_DELAY_SECONDS,
      conversationStalenessMinutes:
        settings?.conversation_staleness_minutes ?? DEFAULT_CONVERSATION_STALENESS_MINUTES,
      faqSnippets,
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyResideSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const parsed = resideUpdateTenantSettingsInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const {
    tenantId,
    defaultResponseWindowMinutes,
    externalSendDelaySeconds,
    conversationStalenessMinutes,
    faqSnippets,
  } = parsed.data;
  if (tenantId !== id) {
    return Response.json({ error: "tenantId does not match the route" }, { status: 400 });
  }

  const admin = createAdminService();
  const tenant = await admin.getTenantByResideClientUid(id);
  if (!tenant) {
    return new Response("Unknown tenant", { status: 404 });
  }

  const settings = await createDomainService().updateTenantSettings(tenant.id, {
    ...(defaultResponseWindowMinutes !== undefined && {
      default_response_window_minutes: defaultResponseWindowMinutes,
    }),
    ...(externalSendDelaySeconds !== undefined && { external_send_delay_seconds: externalSendDelaySeconds }),
    ...(conversationStalenessMinutes !== undefined && {
      conversation_staleness_minutes: conversationStalenessMinutes,
    }),
    ...(faqSnippets !== undefined && { faq_snippets: faqSnippets }),
  });

  const faqRaw = settings.faq_snippets;
  const responseFaqSnippets = Array.isArray(faqRaw)
    ? (faqRaw as Array<{ q?: string; a?: string }>).map((f) => ({ q: f.q ?? "", a: f.a ?? "" }))
    : [];

  return Response.json({
    settings: {
      defaultResponseWindowMinutes: settings.default_response_window_minutes,
      externalSendDelaySeconds: settings.external_send_delay_seconds,
      conversationStalenessMinutes: settings.conversation_staleness_minutes,
      faqSnippets: responseFaqSnippets,
    },
  });
}
