import { createAdminService, createDomainService } from "@communication-canoe/database";
import type { ConversationThread } from "@communication-canoe/database";
import { z } from "zod";

const uuidSchema = z.string().uuid();

export type MemberMessage = {
  id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  direction: "inbound" | "outbound";
  sender_type: "external" | "internal_user" | "ai_agent" | "system";
  body: string;
  created_at: string;
};

export type MemberConversationThread = {
  id: string;
  status: "open" | "pending" | "resolved";
  created_at: string;
  last_message_at: string;
  messages: MemberMessage[];
};

/** Read-only identity lookup - never creates or merges (see
 * DomainService.findIdentityForContact's docblock for why). Used by the
 * list/thread routes; the reply route uses findOrCreateIdentity instead,
 * since creating an identity for a genuinely first-time contact is
 * legitimate there. */
export async function findResidentIdentity(
  tenantId: string,
  contact: { phone?: string; email?: string },
) {
  return createDomainService().findIdentityForContact(tenantId, contact);
}

/**
 * The actual new invariant Phase 4 introduces: does this conversation belong
 * to this identity (accounting for identity merges)? All DomainService calls
 * use the Postgres service-role key and bypass RLS entirely, so this check -
 * plus the tenant check callers do alongside it - is the ENTIRE security
 * boundary, same as Phase 3's conversation-guard.ts, but anchored to a
 * phone/email match rather than a stable session-issued id.
 */
export async function verifyConversationOwnership(
  conversation: { identityId: string },
  identityId: string,
): Promise<boolean> {
  const chainIds = await createDomainService().getIdentityMergeChainIds(identityId);
  return chainIds.includes(conversation.identityId);
}

/** Trims a full (staff-shaped) ConversationThread down to what a resident
 * may see: messages filtered to visibility === 'external' only (already
 * sufficient alone per Phase 2's audit - every AI-agent and customer-facing
 * message is already tagged external, internal admin notes are the only
 * thing this excludes) and stripped of staff-only fields (sender_id,
 * delivery internals, ai_review_status, scheduled_send_at, opened_at) and
 * staff-only concepts (tags/assignees/participants) entirely. */
export function toMemberSafeThread(conversation: ConversationThread): MemberConversationThread {
  return {
    id: conversation.id,
    // getConversationThread (Phase 7) always resolves a merged-away id to
    // its canonical target before returning, so status is never actually
    // 'merged' here in practice - this fallback exists only so the
    // resident-facing type stays narrow (a resident should never see
    // "merged" as a conversation state) without weakening it to admit the
    // value TypeScript otherwise proves is possible.
    status: conversation.status === "merged" ? "resolved" : conversation.status,
    created_at: conversation.createdAt.toISOString(),
    last_message_at: conversation.lastMessageAt.toISOString(),
    messages: conversation.messages
      .filter((m) => m.visibility === "external")
      .map((m) => ({
        id: m.id,
        channel: m.channel,
        direction: m.direction,
        sender_type: m.senderType,
        body: m.body,
        created_at: m.createdAt.toISOString(),
      })),
  };
}

export type MemberConversationGuardResult =
  | { ok: true; conversation: ConversationThread; identityId: string }
  | { ok: false; status: 404 };

/** Shared gate for the thread/reply routes: tenant exists, an identity
 * resolves for the given contact, and the conversation belongs to that
 * identity (merge-chain-aware) - uniform 404 on any failure, never
 * distinguishing "no such conversation" from "wrong resident" from "unknown
 * tenant", matching Phase 3's conversation-guard.ts precedent exactly. */
export async function resolveOwnedConversation(
  resideClientUid: string,
  conversationId: string,
  identityId: string,
): Promise<MemberConversationGuardResult> {
  // Only conversationId needs a uuid shape check - resideClientUid is reside's
  // own identifier (possibly a slug) and is compared against a text column.
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

  const owned = await verifyConversationOwnership(conversation, identityId);
  if (!owned) return { ok: false, status: 404 };

  return { ok: true, conversation, identityId };
}
