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
 * Both ids are validated as UUIDs before hitting Postgres - `id`/`tenantId`
 * columns are `uuid` type, so a malformed value (e.g. reside's slug-style
 * client ids like "cardiff" for tenants never provisioned into comm-canoe)
 * would otherwise throw an unhandled type-cast error from the query layer
 * instead of a clean 404. Found via live Phase 3 verification.
 */
export async function resolveTenantScopedConversation(
  tenantId: string,
  conversationId: string,
): Promise<ConversationGuardResult> {
  if (!uuidSchema.safeParse(tenantId).success || !uuidSchema.safeParse(conversationId).success) {
    return { ok: false, status: 404 };
  }

  const admin = createAdminService();
  const domain = createDomainService();

  const tenant = await admin.getTenantById(tenantId);
  if (!tenant) return { ok: false, status: 404 };

  const conversation = await domain.getConversationThread(conversationId);
  if (!conversation || conversation.tenant_id !== tenantId) {
    return { ok: false, status: 404 };
  }

  return { ok: true, tenant, conversation };
}
