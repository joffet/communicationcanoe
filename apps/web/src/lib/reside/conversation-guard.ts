import { createAdminService, createDomainService } from "@communication-canoe/database";
import type { ConversationThread, Tenant } from "@communication-canoe/database";
import { z } from "zod";

const uuidSchema = z.string().uuid();

export type ConversationGuardResult =
  | { ok: true; tenant: Tenant; conversation: ConversationThread }
  | { ok: false; status: 404 };

/**
 * Shared tenant-isolation gate for every internal/reside/conversations/*
 * route: confirms the tenant exists AND the conversation belongs to it,
 * rejecting with a uniform 404 (never distinguishing "no such conversation"
 * from "wrong tenant") - conversation ids are opaque UUIDs an attacker could
 * otherwise probe across tenants.
 *
 * `conversationId` is still validated as a UUID before hitting Postgres - that
 * column is `uuid` type, so a malformed value would otherwise throw an
 * unhandled type-cast error from the query layer instead of a clean 404.
 * Found via live Phase 3 verification.
 *
 * `resideClientUid` deliberately is NOT uuid-checked: it is reside's own client
 * identifier and may be a slug (e.g. "cardiff"). It is only ever compared
 * against the text `tenants.reside_client_uid` column, so it can never reach a
 * uuid comparison - which is what the old check was guarding against. Tenant
 * scoping below uses the resolved `tenant.id`, never this value.
 */
export async function resolveTenantScopedConversation(
  resideClientUid: string,
  conversationId: string,
): Promise<ConversationGuardResult> {
  if (!uuidSchema.safeParse(conversationId).success) {
    return { ok: false, status: 404 };
  }

  const admin = createAdminService();
  const domain = createDomainService();

  const tenant = await admin.getTenantByResideClientUid(resideClientUid);
  if (!tenant) return { ok: false, status: 404 };

  const conversation = await domain.getConversationThread(conversationId);
  if (!conversation || conversation.tenantId !== tenant.id) {
    return { ok: false, status: 404 };
  }

  return { ok: true, tenant, conversation };
}
