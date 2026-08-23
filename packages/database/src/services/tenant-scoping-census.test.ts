/**
 * Which service methods can enforce tenancy, and which cannot.
 *
 * A source-level check, in the spirit of the isolation tests next door but
 * answering a different question. Those prove that a method taking a
 * `tenantId` actually uses it. This one is about the methods that take no
 * tenantId at all — `getConversationThread(conversationId)`,
 * `getMessageById(messageId)`, `listConversationTags(conversationId)`.
 *
 * They are not bugs. Five of the tables they touch carry no `tenant_id`
 * column at all (conversation_tags, conversation_assignees,
 * conversation_participants, conversation_read_states,
 * conversation_personal_tags), so there is nothing to filter on: they hang
 * off a conversation, and the conversation is what has an owner. A method
 * given only an id cannot know whose id it is.
 *
 * That makes the CALLER the security boundary for every one of them, and
 * that is exactly where this codebase's cross-tenant bugs have come from:
 * the resident who could read every conversation, the batch status endpoint,
 * and two route fixes since the PlanetScale cutover, both of the form
 * "resolve the tenant before using the id".
 *
 * So the list below is a liability register, not a to-do list. It fails when
 * it changes, which forces one of two decisions on whoever added a method:
 * take a `tenantId` and filter by it, or add the name here and accept that
 * every call site must prove ownership first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "index.ts"),
  "utf8",
);

/**
 * Public async methods of DomainService, with their parameter lists.
 *
 * Parentheses are matched rather than pattern-ended at `): Type`. Seven of
 * these methods have no return-type annotation, and a lazy regex reading up
 * to the first `):` swallows the method BODY as its parameters — which makes
 * any method mentioning tenantId internally look tenant-scoped when its
 * signature takes no tenant at all. `assignConversationTeam` is exactly that
 * case, and it is caller-enforced. A guard that can be fooled by a missing
 * type annotation is worse than no guard, because it reports safety.
 */
function publicMethods(): { name: string; params: string }[] {
  const out: { name: string; params: string }[] = [];
  const re = /\n  async (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < source.length && depth > 0; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    out.push({ name: m[1], params: source.slice(start, i - 1).split(/\s+/).join(" ") });
  }
  return out;
}

const ENTITY_ID = /\b(conversationId|messageId|batchId|recipientId|identityId|participantId|tagId|documentId|transferId)\b/;

const scoped = (p: string) => /\btenantId\b/.test(p);
const idOnly = (p: string) => !scoped(p) && ENTITY_ID.test(p);

/**
 * Methods that take an entity id and no tenant, so their caller must have
 * already established ownership.
 *
 * Adding to this list is a deliberate act. Prefer taking a `tenantId` and
 * filtering by it — `getOutboundBatchDetail(batchId, tenantId)` is the shape
 * to copy, and it exists because the version without the tenantId leaked.
 */
const CALLER_ENFORCED = [
  "addConversationAssignee",
  "addConversationParticipant",
  "addConversationPersonalTag",
  "addConversationTag",
  "applyToneReviewResult",
  "approveFlaggedMessage",
  "assignConversationTeam",
  "assignConversationUser",
  "cancelScheduledMessage",
  "claimOutboundBatchRecipient",
  "claimOverdueConversationNotification",
  "claimPendingDocument",
  "claimScheduledMessage",
  "claimTopicCheckMessage",
  "claimVoicemailTranscription",
  "getConversationMergeChainIds",
  "getConversationSplitOrigin",
  "getConversationThread",
  "getIdentityMergeChainIds",
  "getMessageById",
  "getOutboundBatch",
  "incrementOutboundBatchCompleted",
  "listConversationAssignees",
  "listConversationParticipants",
  "listConversationPersonalTags",
  "listConversationTags",
  "listOutboundBatchRecipients",
  "markConversationRead",
  "markDocumentFailed",
  "markDocumentReady",
  "markMessageOpened",
  "markMessageTranscriptionFailed",
  "markTopicCheckReviewed",
  "recordChannelDeliveryOutcome",
  "removeConversationAssignee",
  "removeConversationParticipant",
  "removeConversationPersonalTag",
  "removeConversationTag",
  "resolveConversationId",
  "setConversationResponseDueAt",
  "updateConversationPriority",
  "updateConversationStatus",
  "updateConversationSummary",
  "updateLiveTransferOutcome",
  "updateMessageDeliveryStatus",
  "updateMessageTranscription",
  "updateOutboundBatchRecipientStatus",
].sort();

describe("tenant scoping census", () => {
  it("finds the service surface (sanity check that the parse works)", () => {
    const methods = publicMethods();
    // All 96, including the seven with no return-type annotation.
    expect(methods.length).toBe(96);
    expect(methods.map((m) => m.name)).toContain("getConversationsForTenant");
  });

  /**
   * The register is exact in both directions. A new caller-enforced method
   * that is not listed fails here; a listed method that gained a `tenantId`
   * and no longer needs the exemption fails here too, so the list cannot
   * quietly outlive its reason.
   */
  it("matches the register of caller-enforced methods exactly", () => {
    const actual = publicMethods().filter((m) => idOnly(m.params)).map((m) => m.name).sort();

    const unregistered = actual.filter((n) => !CALLER_ENFORCED.includes(n));
    expect(
      unregistered,
      "new method takes an entity id but no tenantId — give it a tenantId and " +
        "filter by it, or add it to CALLER_ENFORCED and make every call site " +
        "prove ownership first",
    ).toEqual([]);

    const stale = CALLER_ENFORCED.filter((n) => !actual.includes(n));
    expect(stale, "listed as caller-enforced but no longer takes a bare entity id").toEqual([]);
  });

  /** The shape worth copying: an id plus the tenant that must own it. */
  it("keeps the batch detail read scoped, since the unscoped version leaked", () => {
    const detail = publicMethods().find((m) => m.name === "getOutboundBatchDetail");
    expect(detail).toBeDefined();
    expect(scoped(detail!.params)).toBe(true);
  });

  it("keeps every tenant-scoped method's tenantId in its signature", () => {
    const names = publicMethods().filter((m) => scoped(m.params)).map((m) => m.name);
    for (const required of [
      "getConversationsForTenant",
      "listConversationsForIdentity",
      "listTenantTags",
      "getTeamsForTenant",
      "listDocumentsForTenant",
      "getDocument",
      "findIdentityForContact",
      "getMessageByIdempotencyKey",
      "mergeConversations",
    ]) {
      expect(names, `${required} lost its tenantId parameter`).toContain(required);
    }
  });
});
