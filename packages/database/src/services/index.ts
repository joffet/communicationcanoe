import type {
  AppendMessageInput,
  AnonymousIdentityInput,
  ConvertIdentityInput,
  ConversationFilters,
  IdentityContact,
  LogLiveTransferInput,
} from "@communication-canoe/shared";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { createDb, type Db } from "../db";
import {
  conversationSplits,
  documentChunks,
  documents,
  liveTransfers,
  teamMemberships,
  teams,
  tenantSettings,
  tenants,
  userTenantMemberships,
  users,
  identities,
  identityConversionLogs,
  identityMergeLogs,
  conversations as conversationsTable,
  conversationAssignees,
  conversationParticipants,
  conversationTags,
  tags,
  conversationPersonalTags,
  conversationReadStates,
  messages,
  outboundBatchRecipients,
  outboundBatches,
} from "../schema";
import { normalizeEmail, normalizePhone } from "../client";
import { notifyDashboardConversation } from "../realtime/notify";
import {
  createChatSessionToken,
  verifyChatSessionToken,
} from "./chat-session";
import type {
  Conversation,
  ConversationAssignee,
  ConversationExtras,
  ConversationParticipant,
  ConversationPersonalTag,
  ConversationPriority,
  ConversationReadState,
  ConversationThread,
  ConversationViewerState,
  ConversationWithIdentity,
  Document,
  Identity,
  LiveTransfer,
  Message,
  MessageDeliveryStatus,
  NewDocumentChunk,
  OutboundBatch,
  OutboundBatchRecipient,
  Tag,
  Team,
  Tenant,
  TenantSettings,
} from "../types";
import type { TenantId } from "@communication-canoe/shared/brands";
import type { ResideMessageAttachment } from "@communication-canoe/shared/schemas";

/** Strips repeated Re:/Fwd:/FW: prefixes and normalizes whitespace/case, so
 * "Re: Fwd: Parking permit" and "parking permit" compare equal. No existing
 * normalization exists anywhere in this codebase for email subjects
 * (confirmed via Phase 9 research) - built from scratch, deliberately
 * minimal (no dedicated library) since this is only ever used as a
 * best-effort fast-path signal, not a source of truth. */
function normalizeEmailSubject(subject: string): string {
  let s = subject.trim();
  let stripped = true;
  while (stripped) {
    const next = s.replace(/^(re|fwd?|fw)\s*:\s*/i, "");
    stripped = next !== s;
    s = next.trim();
  }
  return s.toLowerCase();
}

export class DomainService {
  #orm?: Db;

  /**
   * The connection is lazy because nothing should pay for one it never uses:
   * realtime-bridge constructs a DomainService on every worker tick, and most
   * ticks find nothing to do.
   */
  constructor(ormOverride?: Db) {
    this.#orm = ormOverride;
  }

  protected get orm(): Db {
    return (this.#orm ??= createDb());
  }

  async resolveTenantByPhone(phone: string): Promise<Tenant | null> {
    const normalized = normalizePhone(phone);
    const [byNormalized] = await this.orm
      .select().from(tenants).where(eq(tenants.twilioNumber, normalized)).limit(1);
    if (byNormalized) return byNormalized;

    // Fall back to the raw value: numbers stored before normalization existed
    // are still the tenant's, and failing to match one silently drops an
    // inbound call or text.
    const [byRaw] = await this.orm
      .select().from(tenants).where(eq(tenants.twilioNumber, phone)).limit(1);
    return byRaw ?? null;
  }

  async resolveTenantByEmail(email: string): Promise<Tenant | null> {
    const normalized = normalizeEmail(email);
    const [tenant] = await this.orm
      .select().from(tenants).where(eq(tenants.inboundEmailAddress, normalized)).limit(1);
    return tenant ?? null;
  }

  async resolveTenantByWidgetKey(key: string): Promise<Tenant | null> {
    const [tenant] = await this.orm
      .select().from(tenants).where(eq(tenants.chatWidgetKey, key)).limit(1);
    return tenant ?? null;
  }

  async findOrCreateAnonymousIdentity(
    tenantId: TenantId,
    input: AnonymousIdentityInput,
  ): Promise<Identity> {
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const name = input.name?.trim() || undefined;

    if (email) {
      return this.findOrCreateIdentity(tenantId, { email, name });
    }

    const [identity] = await this.orm
      .insert(identities)
      .values({ tenantId, phone: null, email: null, name: name ?? null, isAnonymous: true })
      .returning();

    return identity;
  }

  async convertIdentity(
    identityId: string,
    tenantId: TenantId,
    input: ConvertIdentityInput,
    convertedBy: "system" | "user" = "system",
    convertedByUserId?: string,
  ): Promise<Identity> {
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const name = input.name?.trim() || undefined;

    // Scoped by tenant as well as id: an identity id from another tenant must
    // not be convertible, and the id alone does not establish ownership.
    const [existing] = await this.orm
      .select()
      .from(identities)
      .where(and(eq(identities.id, identityId), eq(identities.tenantId, tenantId)))
      .limit(1);
    if (!existing) throw new Error(`Unknown identity: ${identityId}`);

    const [updated] = await this.orm
      .update(identities)
      .set({
        phone: phone ?? existing.phone,
        email: email ?? existing.email,
        name: name ?? existing.name,
        isAnonymous: false,
      })
      .where(eq(identities.id, identityId))
      .returning();
    const data = updated;

    await this.orm.insert(identityConversionLogs).values({
      tenantId,
      identityId,
      convertedBy,
      convertedByUserId: convertedByUserId ?? null,
      capturedName: name ?? existing.name,
      capturedEmail: email ?? existing.email,
      capturedPhone: phone ?? existing.phone,
    });

    return data;
  }

  async logLiveTransfer(input: LogLiveTransferInput): Promise<LiveTransfer> {
    const [transfer] = await this.orm
      .insert(liveTransfers)
      .values({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        channel: input.channel,
        attemptedUserId: input.attemptedUserId ?? null,
        messageId: input.messageId ?? null,
        outcome: input.outcome,
        reason: input.reason ?? null,
      })
      .returning();

    return transfer;
  }

  /** The escalation still waiting on a human, if there is one — the row
   * beginHandoff writes as `pending` and agentJoin flips to `answered`.
   * Takes the tenant rather than trusting the caller with a bare id, since
   * the reason text it carries is the visitor's own words. */
  async getPendingLiveTransfer(
    conversationId: string,
    tenantId: TenantId,
  ): Promise<LiveTransfer | null> {
    const [transfer] = await this.orm
      .select()
      .from(liveTransfers)
      .where(and(
        eq(liveTransfers.conversationId, conversationId),
        eq(liveTransfers.tenantId, tenantId),
        eq(liveTransfers.outcome, "pending"),
      ))
      .orderBy(desc(liveTransfers.createdAt)).limit(1);

    return transfer ?? null;
  }

  async updateLiveTransferOutcome(
    transferId: string,
    outcome: LiveTransfer["outcome"],
    attemptedUserId?: string,
  ): Promise<LiveTransfer> {
    const patch: Partial<LiveTransfer> = { outcome };
    if (attemptedUserId) patch.attemptedUserId = attemptedUserId;

    const [updated] = await this.orm
      .update(liveTransfers).set(patch)
      .where(eq(liveTransfers.id, transferId)).returning();
    return updated;
  }

  async assignConversationUser(conversationId: string, userId: string | null) {
    const [updated] = await this.orm
      .update(conversationsTable)
      .set({ assignedUserId: userId })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return updated;
  }

  createChatSessionToken(
    tenantId: TenantId,
    conversationId: string,
    identityId: string,
  ): string {
    return createChatSessionToken({ tenantId, conversationId, identityId });
  }

  async resumeConversationBySessionToken(
    tenantId: TenantId,
    sessionToken: string,
  ): Promise<{ conversation: Conversation; identity: Identity } | null> {
    const payload = verifyChatSessionToken(sessionToken);
    if (!payload || payload.tenantId !== tenantId) return null;

    const thread = await this.getConversationThread(payload.conversationId);
    if (!thread || thread.tenantId !== tenantId) return null;
    if (thread.status !== "open") return null;

    // Phase 8: a pinned conversation isn't itself broken by having been
    // split (it still exists, still open, per the status check above) -
    // but the resident's next message should continue wherever the newer
    // topic now lives. Single-hop only (not a recursive chain-walk like
    // merge's resolve_conversation_id) - a session surviving through two
    // chained splits of the same lineage is a narrow enough edge case to
    // leave as an accepted v1 gap.
    const [latestSplit] = await this.orm
      .select({ targetConversationId: conversationSplits.targetConversationId })
      .from(conversationSplits)
      .where(eq(conversationSplits.sourceConversationId, thread.id))
      .orderBy(desc(conversationSplits.createdAt)).limit(1);

    if (latestSplit) {
      const splitTarget = await this.getConversationThread(latestSplit.targetConversationId);
      if (splitTarget && splitTarget.status === "open") {
        return { conversation: splitTarget, identity: splitTarget.identity };
      }
    }

    return { conversation: thread, identity: thread.identity };
  }

  async getOnCallUsers(tenantId: TenantId, teamId?: string | null) {
    let teamIds: string[] = [];
    if (teamId) {
      teamIds = [teamId];
    } else {
      const teams = await this.getTeamsForTenant(tenantId);
      teamIds = teams.map((t) => t.id);
    }
    if (!teamIds.length) return [];

    const memberships = await this.orm
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .where(and(
        inArray(teamMemberships.teamId, teamIds),
        eq(teamMemberships.isOnCall, true),
      ));
    if (!memberships.length) return [];

    const userIds = [...new Set(memberships.map((m) => m.userId))];
    return this.orm
      .select().from(users)
      .where(and(inArray(users.id, userIds), eq(users.availableForCalls, true)));
  }

  async findOrCreateIdentity(
    tenantId: TenantId,
    contact: IdentityContact,
  ): Promise<Identity> {
    const phone = contact.phone ? normalizePhone(contact.phone) : undefined;
    const email = contact.email ? normalizeEmail(contact.email) : undefined;

    let existing: Identity | null = null;

    if (phone) {
      existing = await this.findIdentityByPhone(tenantId, phone);
    }
    if (email) {
      const byEmail = await this.findIdentityByEmail(tenantId, email);
      if (byEmail) {
        if (existing && existing.id !== byEmail.id) {
          await this.mergeIdentities(tenantId, existing.id, byEmail.id, "email");
          existing = await this.getCanonicalIdentity(existing.id);
        } else if (!existing) {
          existing = byEmail;
        }
      }
    }

    if (existing) {
      if (phone && !existing.phone) {
        await this.orm.update(identities).set({ phone }).where(eq(identities.id, existing.id));
        existing.phone = phone;
      }
      if (email && !existing.email) {
        await this.orm.update(identities).set({ email }).where(eq(identities.id, existing.id));
        existing.email = email;
      }
      if (contact.name && !existing.name) {
        await this.orm.update(identities).set({ name: contact.name }).where(eq(identities.id, existing.id));
        existing.name = contact.name;
      }
      if (contact.resideResidentId && !existing.resideResidentId) {
        await this.orm
          .update(identities)
          .set({ resideResidentId: contact.resideResidentId })
          .where(eq(identities.id, existing.id));
        existing.resideResidentId = contact.resideResidentId;
      }
      return this.getCanonicalIdentity(existing.id);
    }

    // onConflictDoNothing, then read back what won.
    //
    // Two sends for the same person landing at once - which is exactly what
    // parallelising the outbound batch worker produces - both find nothing
    // above and both insert. The unique indexes mean the data cannot be
    // corrupted either way; without this the loser threw a 23505 at a caller
    // that was only trying to look somebody up.
    //
    // No conflict target: the row can collide on phone, on email, or on
    // resideResidentId, and naming one of them would leave the other two
    // throwing.
    const [created] = await this.orm
      .insert(identities)
      .values({
        tenantId,
        phone: phone ?? null,
        email: email ?? null,
        name: contact.name ?? null,
        resideResidentId: contact.resideResidentId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    // Lost the race. Whoever won inserted a row matching this contact, so the
    // same lookups that found nothing a moment ago find it now.
    const winner =
      (phone ? await this.findIdentityByPhone(tenantId, phone) : null) ??
      (email ? await this.findIdentityByEmail(tenantId, email) : null);
    if (winner) return this.getCanonicalIdentity(winner.id);

    // Nothing inserted and nothing found. A conflict on a column neither
    // lookup covers - resideResidentId - is the only way here, and it means
    // this contact's reside id is already held by an identity carrying
    // different contact details. Worth failing loudly rather than inventing
    // an identity to return.
    throw new Error(
      `findOrCreateIdentity: insert conflicted but no matching identity found (tenant ${tenantId})`,
    );
  }

  /**
   * Read-only counterpart to findOrCreateIdentity (Phase 4) - matches by
   * phone then email like findOrCreateIdentity does, but never creates or
   * merges. findOrCreateIdentity can silently merge two people's identities
   * (mergeIdentities, no confirmation step) when a passed phone and email
   * each independently match a different existing row - a real mutation,
   * unsafe to trigger from a polled read path (list/thread conversations).
   */
  async findIdentityForContact(
    tenantId: TenantId,
    contact: { phone?: string; email?: string },
  ): Promise<Identity | null> {
    const phone = contact.phone ? normalizePhone(contact.phone) : undefined;
    const email = contact.email ? normalizeEmail(contact.email) : undefined;

    if (phone) {
      const byPhone = await this.findIdentityByPhone(tenantId, phone);
      if (byPhone) return this.getCanonicalIdentity(byPhone.id);
    }
    if (email) {
      const byEmail = await this.findIdentityByEmail(tenantId, email);
      if (byEmail) return this.getCanonicalIdentity(byEmail.id);
    }
    return null;
  }

  /** Phase 9: this used to assume at most one open conversation per
   * identity and throw (`.maybeSingle()` on 2+ rows) the instant that
   * stopped being true - a state Phase 8's split feature made real and
   * reachable, confirmed live as an actual regression before this rewrite.
   * Now real routing logic: resolves every open conversation across the
   * identity's merge chain (mirrors listConversationsForIdentity's
   * getIdentityMergeChainIds walk, filtered to status='open', skipping
   * that function's tags/assignees hydration - routing needs none of it),
   * and picks a candidate with fast, synchronous, no-AI logic -
   * appendMessage's conversation_id is NOT NULL, so a webhook can't block
   * on an AI classification before inserting. Returns whether the resolved
   * conversation was stale, so inbound-webhook callers can flag the
   * message for the async AI topic-shift check (conversation-routing-worker). */
  async findOrCreateConversation(
    tenantId: TenantId,
    identityId: string,
    context?: { channel?: string; subject?: string },
  ): Promise<{ conversation: Conversation; isStale: boolean }> {
    const canonicalId = await this.resolveIdentityId(identityId);
    const identityChainIds = await this.getIdentityMergeChainIds(canonicalId);

    const openCandidates = await this.orm
      .select()
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.tenantId, tenantId),
        inArray(conversationsTable.identityId, identityChainIds),
        eq(conversationsTable.status, "open"),
      ))
      .orderBy(desc(conversationsTable.lastMessageAt));

    const candidates = openCandidates ?? [];

    if (candidates.length === 0) {
      const [created] = await this.orm
        .insert(conversationsTable)
        .values({ tenantId, identityId: canonicalId, status: "open" })
        .returning();
      return { conversation: created, isStale: false };
    }

    // Default: most-recently-active candidate (query already ordered desc).
    // Known imprecision, documented rather than silently assumed correct:
    // last_message_at updates on *any* message (internal notes, system
    // sends included), so this means "most recently active," not "most
    // recently resident-engaged."
    let selected = candidates[0];

    if (candidates.length > 1 && context?.channel === "email" && context.subject) {
      const matched = await this.findConversationBySubjectMatch(candidates, context.subject);
      if (matched) selected = matched;
    }

    const settings = await this.getTenantSettings(tenantId);
    const stalenessMinutes = settings?.conversationStalenessMinutes ?? 1440;
    const staleBefore = Date.now() - stalenessMinutes * 60_000;
    const isStale = new Date(selected.lastMessageAt).getTime() < staleBefore;

    return { conversation: selected, isStale };
  }

  /** Matches by the most recent message's subject *in any candidate,
   * regardless of that message's channel* (not just the most recent email)
   * - a documented simplification, not an oversight: keeps this fast-path
   * step simple, and a miss just falls through to the recency tiebreak. */
  private async findConversationBySubjectMatch(
    candidates: Conversation[],
    newSubject: string,
  ): Promise<Conversation | null> {
    const candidateIds = candidates.map((c) => c.id);
    const recentMessages = await this.orm
      .select({
        conversationId: messages.conversationId,
        subject: messages.subject,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(
        inArray(messages.conversationId, candidateIds),
        isNotNull(messages.subject),
      ))
      .orderBy(desc(messages.createdAt));

    const latestSubjectByConversation = new Map<string, string>();
    for (const m of recentMessages ?? []) {
      if (!latestSubjectByConversation.has(m.conversationId) && m.subject) {
        latestSubjectByConversation.set(m.conversationId, m.subject);
      }
    }

    const normalizedNew = normalizeEmailSubject(newSubject);
    for (const candidate of candidates) {
      const subject = latestSubjectByConversation.get(candidate.id);
      if (subject && normalizeEmailSubject(subject) === normalizedNew) {
        return candidate;
      }
    }
    return null;
  }

  async appendMessage(input: AppendMessageInput): Promise<Message> {
    // Two AFTER INSERT triggers hang off this table - conversations.lastMessageAt
    // and the SLA response clock - and they fire on the row regardless of which
    // client wrote it, so nothing here has to maintain either.
    const [message] = await this.orm
      .insert(messages)
      .values({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        channel: input.channel,
        direction: input.direction,
        senderType: input.senderType,
        senderId: input.senderId ?? null,
        body: input.body,
        subject: input.subject ?? null,
        audioUrl: input.audioUrl ?? null,
        transcript: input.transcript ?? null,
        aiSummary: input.aiSummary ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        deliveryStatus: input.deliveryStatus ?? null,
        // Omit the key entirely (not `?? null`) when unset, so the column's
        // NOT NULL DEFAULT 'internal' applies - explicit null would violate it.
        ...(input.visibility !== undefined && { visibility: input.visibility }),
        scheduledSendAt: input.scheduledSendAt ? new Date(input.scheduledSendAt) : null,
        aiReviewStatus: input.aiReviewStatus ?? null,
        topicCheckStatus: input.topicCheckStatus ?? null,
        transcriptionStatus: input.transcriptionStatus ?? null,
      })
      .returning();

    return message;
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    const [message] = await this.orm
      .select().from(messages).where(eq(messages.id, messageId)).limit(1);
    return message ?? null;
  }

  /** Looks up a prior send by reside's idempotency key. Scoped by tenant to
   * match the partial unique index, so two tenants can never collide. */
  async getMessageByIdempotencyKey(tenantId: TenantId, idempotencyKey: string): Promise<Message | null> {
    const [message] = await this.orm
      .select().from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, idempotencyKey)))
      .limit(1);
    return message ?? null;
  }

  async getMessageByProviderMessageId(providerMessageId: string): Promise<Message | null> {
    const [message] = await this.orm
      .select().from(messages)
      .where(eq(messages.providerMessageId, providerMessageId)).limit(1);
    return message ?? null;
  }

  async updateMessageDeliveryStatus(
    messageId: string,
    patch: {
      deliveryStatus: MessageDeliveryStatus;
      providerMessageId?: string;
      deliveryError?: string | null;
      sentAt?: string;
      deliveredAt?: string;
      incrementAttempts?: boolean;
    },
  ): Promise<Message> {
    if (patch.incrementAttempts) {
      // Incremented in SQL rather than read-then-write: two delivery webhooks
      // for the same message can land at once, and a JS increment off a
      // snapshot loses one of them.
      const [updated] = await this.orm
        .update(messages)
        .set({
          deliveryStatus: patch.deliveryStatus,
          providerMessageId: patch.providerMessageId,
          deliveryError: patch.deliveryError ?? null,
          sentAt: patch.sentAt ? new Date(patch.sentAt) : null,
          deliveredAt: patch.deliveredAt ? new Date(patch.deliveredAt) : null,
          deliveryAttempts: sql`${messages.deliveryAttempts} + 1`,
        })
        .where(eq(messages.id, messageId))
        .returning();

      return updated;
    }

    const [updated] = await this.orm
      .update(messages)
      .set({
        deliveryStatus: patch.deliveryStatus,
        providerMessageId: patch.providerMessageId,
        deliveryError: patch.deliveryError ?? null,
        sentAt: patch.sentAt ? new Date(patch.sentAt) : null,
        deliveredAt: patch.deliveredAt ? new Date(patch.deliveredAt) : null,
      })
      .where(eq(messages.id, messageId))
      .returning();

    return updated;
  }

  // ---- Scheduled external-send dispatch (Phase 3) ----

  /** Best-effort snapshot of due scheduled sends - not itself a claim, see
   * claimScheduledMessage for the atomic per-row step that actually is.
   * Phase 6: also requires ai_review_status = 'approved' - a flagged or
   * still-pending-review message is never due, mirroring how this query
   * already redundantly checks delivery_status alongside claimScheduledMessage. */
  async listDueScheduledMessageIds(limit: number): Promise<string[]> {
    const data = await this.orm
      .select({ id: messages.id })
      .from(messages)
      .where(and(
        eq(messages.visibility, "external"),
        eq(messages.deliveryStatus, "queued"),
        eq(messages.aiReviewStatus, "approved"),
        isNotNull(messages.scheduledSendAt),
        lte(messages.scheduledSendAt, new Date()),
      ))
      .orderBy(asc(messages.scheduledSendAt))
      .limit(limit);

    return data.map((row) => row.id);
  }

  /** Atomically claims one scheduled message for dispatch: the conditional
   * `delivery_status = 'queued'` in the WHERE clause is a single-row
   * Postgres UPDATE, so it's race-safe against a concurrent cancel or a
   * second worker tick without any extra locking - if the row already moved
   * out of 'queued' (canceled, or already claimed), this returns null.
   * Phase 6: also requires ai_review_status = 'approved', same reasoning as
   * listDueScheduledMessageIds above - a flagged message can never be
   * claimed even if something else raced past the snapshot check. */
  async claimScheduledMessage(messageId: string): Promise<Message | null> {
    const [data] = await this.orm
      .update(messages)
      .set({ deliveryStatus: "sending" })
      .where(and(
        eq(messages.id, messageId),
        eq(messages.deliveryStatus, "queued"),
        eq(messages.aiReviewStatus, "approved"),
      ))
      .returning();
    // `?? null` matters: destructuring an empty returning() array yields
    // undefined, and callers here check for null. Losing that turns "another
    // worker claimed it" into a value that fails a `=== null` guard.
    return data ?? null;
  }

  // ---- Tone review (Phase 6) ----

  /** Snapshot of external messages awaiting tone review - no delivery-status
   * or scheduled-time filter, review should start immediately on queue, not
   * wait for the send delay to elapse. */
  async listPendingToneReviewMessageIds(limit: number): Promise<string[]> {
    const rows = await this.orm
      .select({ id: messages.id }).from(messages)
      .where(and(eq(messages.visibility, "external"), eq(messages.aiReviewStatus, "pending")))
      .orderBy(asc(messages.createdAt)).limit(limit);
    return rows.map((row) => row.id);
  }

  /** Writes a tone-review verdict. No separate atomic-claim step (unlike
   * claimScheduledMessage) - review has no dispatch side-effect to protect
   * against duplicating, so a plain conditional update is enough: a second
   * concurrent worker tick's write matches zero rows (already moved out of
   * 'pending') and silently no-ops. */
  async applyToneReviewResult(
    messageId: string,
    result: { status: "approved" | "flagged"; reasoning: string },
  ): Promise<Message | null> {
    const [data] = await this.orm
      .update(messages)
      .set({ aiReviewStatus: result.status, aiReviewReasoning: result.reasoning })
      .where(and(eq(messages.id, messageId), eq(messages.aiReviewStatus, "pending")))
      .returning();
    return data ?? null;
  }

  /** Admin override for a flagged (or still-pending) message - unblocks the
   * scheduled-message-worker's gate immediately rather than waiting on
   * review. Conditional on the row not already being approved, matching the
   * same idempotent-update idiom used throughout this file. */
  async approveFlaggedMessage(messageId: string): Promise<Message | null> {
    const [data] = await this.orm
      .update(messages)
      .set({ aiReviewStatus: "approved" })
      .where(and(
        eq(messages.id, messageId),
        inArray(messages.aiReviewStatus, ["flagged", "pending"]),
      ))
      .returning();
    return data ?? null;
  }

  /** Best-effort cancel of a still-pending scheduled send - the same
   * conditional-update race-safety as claimScheduledMessage applies: if the
   * worker already claimed it (delivery_status moved to 'sending' or
   * beyond), this correctly no-ops and returns null. */
  async cancelScheduledMessage(messageId: string): Promise<Message | null> {
    const [data] = await this.orm
      .update(messages)
      .set({ deliveryStatus: "canceled" })
      .where(and(eq(messages.id, messageId), eq(messages.deliveryStatus, "queued")))
      .returning();
    return data ?? null;
  }

  /**
   * Creates a bulk-send batch (reside "Notices") plus one pending recipient
   * row per identity. Nothing is dispatched here - the realtime-bridge poll
   * worker (see apps/realtime-bridge/src/workers/outbound-batch-worker.ts)
   * drains pending rows asynchronously through the same per-recipient
   * machinery the single-send endpoint uses.
   */
  async createOutboundBatch(input: {
    tenantId: TenantId;
    channel: "sms" | "email";
    subject?: string;
    body: string;
    recipients: IdentityContact[];
    /** Overrides the tenant's From for every email in this batch. */
    from?: string;
    /** Attachment references for every email in this batch, stored verbatim -
     * see outboundBatches.attachments. Nothing is resolved or fetched here;
     * that happens in the worker, at send time. */
    attachments?: ResideMessageAttachment[];
  }): Promise<OutboundBatch> {
    // One transaction: a batch row claiming N recipients, with no recipient
    // rows behind it, would leave the worker reporting a batch that can never
    // complete. This was two separate round trips with a window between them.
    return this.orm.transaction(async (tx) => {
      const [batch] = await tx
        .insert(outboundBatches)
        .values({
          tenantId: input.tenantId,
          channel: input.channel,
          subject: input.subject ?? null,
          fromAddress: input.from ?? null,
          // Normalised to null rather than an empty array so "this batch has
          // no attachments" is one value in the column, not two.
          attachments: input.attachments?.length ? input.attachments : null,
          totalRecipients: input.recipients.length,
        })
        .returning();

      await tx.insert(outboundBatchRecipients).values(
        input.recipients.map((identity) => ({
          batchId: batch.id,
          tenantId: input.tenantId,
          channel: input.channel,
          identityContact: identity,
          body: input.body,
        })),
      );

      return batch;
    });
  }

  /** Unscoped by tenant on purpose: the outbound-batch worker drains every
   * tenant's batches and has already established which recipient row it is
   * acting on. Reside-facing reads go through getOutboundBatchDetail, which
   * does check. */
  async getOutboundBatch(batchId: string): Promise<OutboundBatch | null> {
    const [batch] = await this.orm
      .select()
      .from(outboundBatches)
      .where(eq(outboundBatches.id, batchId))
      .limit(1);

    return batch ?? null;
  }

  async listOutboundBatchRecipients(batchId: string): Promise<OutboundBatchRecipient[]> {
    return this.orm
      .select()
      .from(outboundBatchRecipients)
      .where(eq(outboundBatchRecipients.batchId, batchId))
      .orderBy(asc(outboundBatchRecipients.createdAt));
  }

  /**
   * Oldest-first pending recipients across all batches/tenants, for the
   * worker's drain tick. No row-locking - fine as long as only one
   * realtime-bridge instance runs the worker loop (true today; revisit if
   * that service is ever horizontally scaled).
   */
  async listPendingOutboundBatchRecipients(limit: number): Promise<OutboundBatchRecipient[]> {
    return this.orm
      .select()
      .from(outboundBatchRecipients)
      .where(eq(outboundBatchRecipients.status, "pending"))
      .orderBy(asc(outboundBatchRecipients.createdAt))
      .limit(limit);
  }

  /** Atomically claims a recipient for one worker replica: pending -> sending.
   * Returns null when another replica got there first, which is the entire
   * double-send guard for bulk Notices. Mirrors claimScheduledMessage. */
  async claimOutboundBatchRecipient(recipientId: string): Promise<OutboundBatchRecipient | null> {
    // The status predicate is the claim: two replicas issuing this at once,
    // only one UPDATE matches a still-pending row and the other returns
    // nothing. Losing it turns this into a double-send.
    const [claimed] = await this.orm
      .update(outboundBatchRecipients)
      .set({ status: "sending", claimedAt: new Date() })
      .where(
        and(
          eq(outboundBatchRecipients.id, recipientId),
          eq(outboundBatchRecipients.status, "pending"),
        ),
      )
      .returning();

    return claimed ?? null;
  }

  /** Returns claimed recipients whose replica died before resolving them, so a
   * later tick can put them back to pending. */
  async reclaimStuckOutboundBatchRecipients(olderThanIso: string): Promise<number> {
    const reclaimed = await this.orm
      .update(outboundBatchRecipients)
      .set({ status: "pending", claimedAt: null })
      .where(
        and(
          eq(outboundBatchRecipients.status, "sending"),
          lt(outboundBatchRecipients.claimedAt, new Date(olderThanIso)),
        ),
      )
      .returning({ id: outboundBatchRecipients.id });

    return reclaimed.length;
  }

  async updateOutboundBatchRecipientStatus(
    recipientId: string,
    patch: { status: "sent" | "failed"; messageId?: string; error?: string | null },
  ): Promise<void> {
    await this.orm
      .update(outboundBatchRecipients)
      .set({
        status: patch.status,
        messageId: patch.messageId ?? null,
        error: patch.error ?? null,
      })
      .where(eq(outboundBatchRecipients.id, recipientId));
  }

  /** Called once per drained recipient; marks the batch completed once every
   * recipient has been processed. */
  /**
   * Counts one recipient done, in the database rather than in this process.
   *
   * Was a read-then-write, which is correct only while the drain is serial.
   * Two workers finishing at once both read the same count and both write it
   * plus one, so the batch loses a tick - and because `status` flips to
   * "completed" by comparing that count to the total, a batch that undercounts
   * even once never completes at all. Reside polls exactly that field.
   *
   * The increment and the comparison are one statement now, so the value the
   * status is derived from is the value that was written.
   */
  async incrementOutboundBatchCompleted(batchId: string): Promise<void> {
    const completed = sql`${outboundBatches.completedRecipients} + 1`;
    const isDone = sql`${completed} >= ${outboundBatches.totalRecipients}`;

    const [updated] = await this.orm
      .update(outboundBatches)
      .set({
        completedRecipients: completed,
        status: sql`case when ${isDone} then 'completed' else 'processing' end`,
        completedAt: sql`case when ${isDone} then now() else null end`,
      })
      .where(eq(outboundBatches.id, batchId))
      .returning({ id: outboundBatches.id });

    // An UPDATE matching nothing succeeds, so the caller would otherwise never
    // learn that the batch it is counting against does not exist.
    if (!updated) throw new Error(`Unknown outbound batch: ${batchId}`);
  }

  /** Composed read for reside's Notice detail page - batch + every recipient's
   * current delivery status, joined from `messages` where dispatched. */
  /**
   * A batch id is a bearer token if nothing checks who is asking, so this
   * takes the tenant and returns null - indistinguishable from "no such
   * batch" - when the batch belongs to someone else. Fetch-then-compare
   * rather than a filtered query, matching how the rest of the reside-facing
   * surface guards ownership (see member-conversation-guard).
   *
   * getOutboundBatch stays unscoped deliberately: its other caller is the
   * outbound-batch worker, which drains every tenant's batches and has
   * already established which recipient row it is acting on.
   */
  async getOutboundBatchDetail(batchId: string, tenantId: TenantId): Promise<{
    batch: OutboundBatch;
    recipients: Array<
      OutboundBatchRecipient & {
        deliveryStatus: MessageDeliveryStatus | null;
        deliveryError: string | null;
        openedAt: Date | null;
        clickedAt: Date | null;
      }
    >;
  } | null> {
    const batch = await this.getOutboundBatch(batchId);
    if (!batch || batch.tenantId !== tenantId) return null;

    const recipients = await this.listOutboundBatchRecipients(batchId);
    const messageIds = recipients.map((r) => r.messageId).filter((id): id is string => Boolean(id));

    const messageMap = new Map<string, Message>();
    if (messageIds.length) {
      const rows = await this.orm
        .select()
        .from(messages)
        .where(inArray(messages.id, messageIds));
      for (const m of rows) messageMap.set(m.id, m as unknown as Message);
    }

    return {
      batch,
      recipients: recipients.map((r) => {
        const message = r.messageId ? messageMap.get(r.messageId) : undefined;
        return {
          ...r,
          deliveryStatus: message?.deliveryStatus ?? null,
          deliveryError: message?.deliveryError ?? null,
          openedAt: message?.openedAt ?? null,
          clickedAt: message?.clickedAt ?? null,
        };
      }),
    };
  }

  /**
   * Idempotent first-open recorder for the tracking pixel - only sets
   * opened_at if unset, so the timestamp reflects the first open.
   *
   * Reports whether this call was the one that recorded it. Callers that
   * notify anyone downstream need that: an image proxy re-fetches a cached
   * pixel every time the message is displayed, so "an open happened" fires
   * repeatedly while "the first open happened" fires once.
   */
  /**
   * Records that a tracked link in this message was followed.
   *
   * Reports whether this was the first click, which callers use the way
   * markMessageOpened's firstOpen is used - except in the opposite direction.
   * An open is notified only on the first, because an image proxy re-fetches
   * a cached pixel every time the message is displayed. A click is notified
   * every time, because each one is a person choosing to go somewhere and a
   * notice with two buttons wants to know which got pressed. `firstClick` is
   * therefore reported for the record, not to gate the notification.
   */
  async recordMessageClick(messageId: string): Promise<{ firstClick: boolean }> {
    const updated = await this.orm
      .update(messages)
      .set({ clickedAt: new Date() })
      .where(and(eq(messages.id, messageId), isNull(messages.clickedAt)))
      .returning({ id: messages.id });

    return { firstClick: updated.length > 0 };
  }

  async markMessageOpened(messageId: string): Promise<{ firstOpen: boolean }> {
    const updated = await this.orm
      .update(messages)
      .set({ openedAt: new Date() })
      .where(and(eq(messages.id, messageId), isNull(messages.openedAt)))
      .returning({ id: messages.id });

    return { firstOpen: updated.length > 0 };
  }

  /**
   * Tracks per-channel consecutive delivery failures on an identity. A
   * success resets the counter (and clears any flag); a hard failure
   * increments it and, on first crossing the tenant's threshold, marks
   * `{channel}_flagged_at` so the caller notifies reside exactly once per
   * failure streak rather than on every subsequent failure past threshold.
   */
  async recordChannelDeliveryOutcome(
    identityId: string,
    channel: "email" | "sms",
    outcome: "success" | "hard_failure",
    threshold: number,
  ): Promise<{ crossedThreshold: boolean; clearedFlag: boolean }> {
    const [identity] = await this.orm
      .select({
        emailConsecutiveFailures: identities.emailConsecutiveFailures,
        phoneConsecutiveFailures: identities.phoneConsecutiveFailures,
        emailFlaggedAt: identities.emailFlaggedAt,
        phoneFlaggedAt: identities.phoneFlaggedAt,
      })
      .from(identities).where(eq(identities.id, identityId)).limit(1);
    if (!identity) throw new Error(`Unknown identity: ${identityId}`);

    if (outcome === "success") {
      const wasFlagged = Boolean(channel === "email" ? identity.emailFlaggedAt : identity.phoneFlaggedAt);
      const update =
        channel === "email"
          ? { emailConsecutiveFailures: 0, emailFlaggedAt: null }
          : { phoneConsecutiveFailures: 0, phoneFlaggedAt: null };
      await this.orm.update(identities).set(update).where(eq(identities.id, identityId));
      return { crossedThreshold: false, clearedFlag: wasFlagged };
    }

    const currentCount =
      channel === "email" ? identity.emailConsecutiveFailures : identity.phoneConsecutiveFailures;
    const alreadyFlagged = Boolean(channel === "email" ? identity.emailFlaggedAt : identity.phoneFlaggedAt);
    const newCount = currentCount + 1;
    const crossedThreshold = newCount >= threshold && !alreadyFlagged;

    const update =
      channel === "email"
        ? {
            emailConsecutiveFailures: newCount,
            ...(crossedThreshold ? { emailFlaggedAt: new Date() } : {}),
          }
        : {
            phoneConsecutiveFailures: newCount,
            ...(crossedThreshold ? { phoneFlaggedAt: new Date() } : {}),
          };

    await this.orm.update(identities).set(update).where(eq(identities.id, identityId));

    return { crossedThreshold, clearedFlag: false };
  }

  async getConversationsForTenant(
    tenantId: TenantId,
    filters: ConversationFilters = { limit: 50 },
  ): Promise<ConversationWithIdentity[]> {
    // A merged-away conversation is a dead pointer, not a real inbox item -
    // exclude it from the unfiltered default so it never clutters the list/
    // kanban views. An explicit status filter (nothing needs 'merged' today)
    // still overrides this.
    const conditions = [
      eq(conversationsTable.tenantId, tenantId),
      filters.status
        ? eq(conversationsTable.status, filters.status)
        : ne(conversationsTable.status, "merged"),
    ];
    if (filters.assignedTeamId) {
      conditions.push(eq(conversationsTable.assignedTeamId, filters.assignedTeamId));
    }

    const conversations = await this.orm
      .select()
      .from(conversationsTable)
      .where(and(...conditions))
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(filters.limit);

    if (!conversations.length) return [];

    const identityIds = [...new Set(conversations.map((c) => c.identityId))];
    const identityRows = await this.orm
      .select()
      .from(identities)
      .where(inArray(identities.id, identityIds));
    const identityMap = new Map(identityRows.map((i) => [i.id, i]));
    const extrasMap = await this.getConversationExtrasMap(conversations.map((c) => c.id));

    return conversations.map((c) => ({
      ...c,
      identity: identityMap.get(c.identityId)!,
      ...(extrasMap.get(c.id) ?? { participants: [], tags: [], assignees: [] }),
    }));
  }

  /** Public wrapper over the identity_merge_chain_ids RPC - given any id in
   * an identity's merge history, returns the canonical id plus every id that
   * transitively merged into it. Used both by listConversationsForIdentity
   * below and by the Phase 4 member-conversation-guard's ownership check. */
  async getIdentityMergeChainIds(identityId: string): Promise<string[]> {
    const result = (await this.orm.execute(
      sql`SELECT * FROM identity_merge_chain_ids(${identityId}::uuid)`,
    )) as { rows: Array<{ identity_merge_chain_ids: string }> };
    return result.rows.map((row) => row.identity_merge_chain_ids);
  }

  /** Phase 7: given any conversation id (including one that's since been
   * merged away), returns its canonical id - public wrapper over
   * resolve_conversation_id, mirroring resolveIdentityId's role for
   * identities. */
  async resolveConversationId(conversationId: string): Promise<string> {
    const result = (await this.orm.execute(
      sql`SELECT resolve_conversation_id(${conversationId}::uuid) AS id`,
    )) as { rows: Array<{ id: string }> };
    return result.rows[0].id;
  }

  /** Phase 7: given a canonical conversation id, returns it plus every id
   * that transitively merged into it - public wrapper over
   * conversation_merge_chain_ids, mirroring getIdentityMergeChainIds. Used
   * by getConversationThread (to gather messages across the whole merge
   * chain, since messages are never physically moved) and
   * listRelatedConversations. */
  /** Walks merged_into_id transitively - a conversation merged into another
   * which was itself merged carries the whole chain. Stays a Postgres function
   * rather than becoming a recursive CTE here: it is the same walk either way,
   * and leaving it in SQL keeps one definition rather than two that can drift. */
  async getConversationMergeChainIds(conversationId: string): Promise<string[]> {
    // Db is the driver-agnostic PgDatabase so the pglite test harness and
    // node-postgres share one type, which costs execute() its result generic.
    const result = (await this.orm.execute(
      sql`SELECT * FROM conversation_merge_chain_ids(${conversationId}::uuid)`,
    )) as { rows: Array<{ conversation_merge_chain_ids: string }> };
    return result.rows.map((row) => row.conversation_merge_chain_ids);
  }

  /**
   * Phase 4's resident-facing conversation list. No equivalent to
   * getConversationsForTenant existed for a single identity before this -
   * uses the identity_merge_chain_ids RPC (not a naive identity_id
   * equality) so a resident doesn't lose visibility into conversations
   * created under an id that later merged into their canonical one.
   */
  async listConversationsForIdentity(
    tenantId: TenantId,
    identityId: string,
  ): Promise<ConversationWithIdentity[]> {
    const ids = await this.getIdentityMergeChainIds(identityId);
    if (ids.length === 0) return [];

    const conversations = await this.orm
      .select()
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.tenantId, tenantId),
        inArray(conversationsTable.identityId, ids),
      ))
      .orderBy(desc(conversationsTable.lastMessageAt));

    if (!conversations.length) return [];

    const identityIds = [...new Set(conversations.map((c) => c.identityId))];
    const identityRows = await this.orm
      .select()
      .from(identities)
      .where(inArray(identities.id, identityIds));
    const identityMap = new Map(identityRows.map((i) => [i.id, i]));
    const extrasMap = await this.getConversationExtrasMap(conversations.map((c) => c.id));

    return conversations.map((c) => ({
      ...c,
      identity: identityMap.get(c.identityId)!,
      ...(extrasMap.get(c.id) ?? { participants: [], tags: [], assignees: [] }),
    }));
  }

  /** Phase 7: resolves a merged-away id to its canonical conversation first
   * (so every caller - comm-canoe's own dashboard, reside's admin thread
   * view, and transitively the Phase 4 member thread view - transparently
   * lands on the live thread), then reads messages across the *entire*
   * merge chain rather than just this one row, since a merge never rewrites
   * messages.conversationId. Callers that need to detect the redirect
   * case (e.g. to issue an HTTP redirect to the canonical URL) compare the
   * returned conversation's `id` against the id they requested. */
  async getConversationThread(conversationId: string): Promise<ConversationThread | null> {
    const canonicalId = await this.resolveConversationId(conversationId);

    const [conversation] = await this.orm
      .select().from(conversationsTable)
      .where(eq(conversationsTable.id, canonicalId)).limit(1);
    if (!conversation) return null;

    const [identity] = await this.orm
      .select()
      .from(identities)
      .where(eq(identities.id, conversation.identityId))
      .limit(1);
    if (!identity) throw new Error(`Unknown identity: ${conversation.identityId}`);

    const chainIds = await this.getConversationMergeChainIds(canonicalId);

    // Reads the whole merge chain, not just the canonical id: a thread that
    // absorbed another still has to show what arrived on the absorbed side.
    const threadMessages = await this.orm
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, chainIds))
      .orderBy(asc(messages.createdAt));

    const extrasMap = await this.getConversationExtrasMap([canonicalId]);

    return {
      ...conversation,
      identity,
      messages: threadMessages,
      ...(extrasMap.get(canonicalId) ?? { participants: [], tags: [], assignees: [] }),
    };
  }

  /** Batch-fetches the Phase 2 additive extras (participants/tags/assignees)
   * for many conversations at once - same batching shape as the identity
   * lookup above, so getConversationsForTenant stays O(1) extra round-trips
   * regardless of list size. */
  private async getConversationExtrasMap(conversationIds: string[]): Promise<Map<string, ConversationExtras>> {
    const map = new Map<string, ConversationExtras>(
      conversationIds.map((id) => [id, { participants: [], tags: [], assignees: [] }]),
    );
    if (conversationIds.length === 0) return map;

    const [participantRows, tagRows, assigneeRows] = await Promise.all([
      this.orm
        .select()
        .from(conversationParticipants)
        .where(inArray(conversationParticipants.conversationId, conversationIds)),
      // This was PostgREST's embedded select, `tags(*)`, which is a join it
      // performs and names after the target table. As a real join the shape is
      // explicit: an inner join drops rows whose tag was deleted, which is what
      // the old code did too by discarding a null `tags`.
      this.orm
        .select({ conversationId: conversationTags.conversationId, tag: tags })
        .from(conversationTags)
        .innerJoin(tags, eq(tags.id, conversationTags.tagId))
        .where(inArray(conversationTags.conversationId, conversationIds)),
      this.orm
        .select()
        .from(conversationAssignees)
        .where(inArray(conversationAssignees.conversationId, conversationIds)),
    ]);

    for (const p of participantRows) {
      map.get(p.conversationId)?.participants.push(p);
    }

    for (const row of tagRows) {
      map.get(row.conversationId)?.tags.push(row.tag);
    }

    for (const a of assigneeRows) {
      map.get(a.conversationId)?.assignees.push(a);
    }

    return map;
  }

  async getTeamsForTenant(tenantId: TenantId): Promise<Team[]> {
    return this.orm
      .select().from(teams)
      .where(eq(teams.tenantId, tenantId)).orderBy(asc(teams.name));
  }

  async assignConversationTeam(conversationId: string, teamId: string | null) {
    const [updated] = await this.orm
      .update(conversationsTable)
      .set({ assignedTeamId: teamId })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return updated;
  }

  async updateConversationSummary(conversationId: string, summary: string) {
    const [updated] = await this.orm
      .update(conversationsTable)
      .set({ summary })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return updated;
  }

  // ---- Tags (Phase 2 / 2A) ----

  async createTag(tenantId: TenantId, name: string, color?: string): Promise<Tag> {
    const [tag] = await this.orm
      .insert(tags)
      .values({ tenantId, name, color: color ?? null })
      .returning();

    return tag;
  }

  async listTenantTags(tenantId: TenantId): Promise<Tag[]> {
    return this.orm.select().from(tags).where(eq(tags.tenantId, tenantId)).orderBy(asc(tags.name));
  }

  async addConversationTag(conversationId: string, tagId: string): Promise<void> {
    await this.orm.insert(conversationTags)
      .values({ conversationId, tagId }).onConflictDoNothing();
  }

  async removeConversationTag(conversationId: string, tagId: string): Promise<void> {
    await this.orm.delete(conversationTags).where(and(
      eq(conversationTags.conversationId, conversationId),
      eq(conversationTags.tagId, tagId),
    ));
  }

  async listConversationTags(conversationId: string): Promise<Tag[]> {
    // The second and last of PostgREST's embedded selects. As a real join the
    // inner-ness is explicit: a tag deleted out from under the link row drops
    // out, which is what the old flatMap over a nullable `tags` did anyway.
    const rows = await this.orm
      .select({ tag: tags })
      .from(conversationTags)
      .innerJoin(tags, eq(tags.id, conversationTags.tagId))
      .where(eq(conversationTags.conversationId, conversationId));
    return rows.map((r) => r.tag);
  }

  // ---- Multi-assignee (Phase 2 / 2B) — additive alongside assignConversationUser/Team above ----

  async addConversationAssignee(
    conversationId: string,
    userId: string,
    assignedBy?: string,
  ): Promise<ConversationAssignee> {
    // Re-assigning someone already assigned must not fail, so the composite
    // key conflict updates rather than raises - it also refreshes assigned_by
    // to whoever most recently did it.
    const [assignee] = await this.orm
      .insert(conversationAssignees)
      .values({ conversationId, userId, assignedBy: assignedBy ?? null })
      .onConflictDoUpdate({
        target: [conversationAssignees.conversationId, conversationAssignees.userId],
        set: { assignedBy: assignedBy ?? null },
      })
      .returning();

    return assignee;
  }

  async removeConversationAssignee(conversationId: string, userId: string): Promise<void> {
    await this.orm.delete(conversationAssignees).where(and(
      eq(conversationAssignees.conversationId, conversationId),
      eq(conversationAssignees.userId, userId),
    ));
  }

  async listConversationAssignees(conversationId: string): Promise<ConversationAssignee[]> {
    return this.orm
      .select()
      .from(conversationAssignees)
      .where(eq(conversationAssignees.conversationId, conversationId));
  }

  // ---- Personal tags (Reside dashboard viewer relevance) — a lighter-weight
  // "relevant to me" marker than assignees, same shape/dedup pattern. ----

  async addConversationPersonalTag(conversationId: string, userId: string): Promise<ConversationPersonalTag> {
    const [tag] = await this.orm
      .insert(conversationPersonalTags)
      .values({ conversationId, userId })
      .onConflictDoUpdate({
        target: [conversationPersonalTags.conversationId, conversationPersonalTags.userId],
        set: { conversationId },
      })
      .returning();
    return tag;
  }

  async removeConversationPersonalTag(conversationId: string, userId: string): Promise<void> {
    await this.orm.delete(conversationPersonalTags).where(and(
      eq(conversationPersonalTags.conversationId, conversationId),
      eq(conversationPersonalTags.userId, userId),
    ));
  }

  async listConversationPersonalTags(conversationId: string): Promise<ConversationPersonalTag[]> {
    return this.orm.select().from(conversationPersonalTags)
      .where(eq(conversationPersonalTags.conversationId, conversationId));
  }

  // ---- Per-user read tracking (Reside dashboard unread counts) ----

  /** Advances userId's read cursor on conversationId to the newest message
   * across its whole merge chain (mirroring getConversationThread's
   * chain-aware read) - written against whatever id the caller passes, so
   * callers resolve to the canonical id first the same way every other
   * conversation-scoped write here does. A conversation with no messages yet
   * (shouldn't happen in practice, but not guaranteed by the schema) falls
   * back to the current time rather than leaving last_read_at null. */
  async markConversationRead(conversationId: string, userId: string): Promise<ConversationReadState> {
    const chainIds = await this.getConversationMergeChainIds(conversationId);

    const [latestMessage] = await this.orm
      .select({ id: messages.id, createdAt: messages.createdAt })
      .from(messages)
      .where(inArray(messages.conversationId, chainIds.length ? chainIds : [conversationId]))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    // Upsert on the composite (conversation_id, user_id) primary key: marking
    // read is idempotent and callers repeat it freely, so a plain insert would
    // fail the second time a viewer opens the same conversation.
    const [state] = await this.orm
      .insert(conversationReadStates)
      .values({
        conversationId,
        userId,
        lastReadAt: latestMessage?.createdAt ?? new Date(),
        lastReadMessageId: latestMessage?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [conversationReadStates.conversationId, conversationReadStates.userId],
        set: {
          lastReadAt: latestMessage?.createdAt ?? new Date(),
          lastReadMessageId: latestMessage?.id ?? null,
        },
      })
      .returning();

    return state;
  }

  /** Batched per-viewer relevance/unread lookup, mirroring
   * getConversationExtrasMap's batching shape - one round trip per source
   * table regardless of list size, scoped to a single viewer since these
   * fields are meaningless without one. Callers pass the conversation rows
   * they already fetched (need only id/last_message_at) rather than this
   * re-querying them. */
  async getViewerConversationStates(
    conversations: Array<Pick<Conversation, "id" | "lastMessageAt">>,
    viewerUserId: string,
  ): Promise<Map<string, ConversationViewerState>> {
    const map = new Map<string, ConversationViewerState>();
    if (conversations.length === 0) return map;

    const conversationIds = conversations.map((c) => c.id);
    const [assigneeRows, personalTagRows, readStateRows] = await Promise.all([
      this.orm
        .select({ conversationId: conversationAssignees.conversationId })
        .from(conversationAssignees)
        .where(
          and(
            eq(conversationAssignees.userId, viewerUserId),
            inArray(conversationAssignees.conversationId, conversationIds),
          ),
        ),
      this.orm
        .select({ conversationId: conversationPersonalTags.conversationId })
        .from(conversationPersonalTags)
        .where(
          and(
            eq(conversationPersonalTags.userId, viewerUserId),
            inArray(conversationPersonalTags.conversationId, conversationIds),
          ),
        ),
      this.orm
        .select({
          conversationId: conversationReadStates.conversationId,
          lastReadAt: conversationReadStates.lastReadAt,
        })
        .from(conversationReadStates)
        .where(
          and(
            eq(conversationReadStates.userId, viewerUserId),
            inArray(conversationReadStates.conversationId, conversationIds),
          ),
        ),
    ]);

    // Relevance is either signal: an assignment someone else made, or a
    // personal tag the viewer applied themselves.
    const relevantIds = new Set<string>([
      ...assigneeRows.map((r) => r.conversationId),
      ...personalTagRows.map((r) => r.conversationId),
    ]);
    const lastReadAtByConversation = new Map(
      readStateRows.map((r) => [r.conversationId, r.lastReadAt]),
    );

    for (const c of conversations) {
      const isRelevant = relevantIds.has(c.id);
      const lastReadAt = lastReadAtByConversation.get(c.id) ?? null;
      const hasUnread =
        isRelevant && (!lastReadAt || lastReadAt < c.lastMessageAt);
      map.set(c.id, {
        viewer_is_relevant: isRelevant,
        viewer_has_unread: hasUnread,
        viewer_last_read_at: lastReadAt ? lastReadAt.toISOString() : null,
      });
    }
    return map;
  }

  /** Dashboard summary counts (avoids shipping full conversation payloads
   * for a two-number card). Mirrors getConversationsForTenant's default of
   * excluding 'merged' - a merged-away source has its assignees/personal
   * tags physically moved off by moveConversationExtras, so it would never
   * show as relevant anyway, but excluding it up front keeps this a single
   * lean query instead of full conversation rows. */
  async getConversationMetricsForViewer(
    tenantId: TenantId,
    viewerUserId: string,
  ): Promise<{ unread_relevant_count: number; open_relevant_count: number }> {
    const rows = await this.orm
      .select({
        id: conversationsTable.id,
        status: conversationsTable.status,
        lastMessageAt: conversationsTable.lastMessageAt,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          ne(conversationsTable.status, "merged"),
        ),
      );
    if (!rows.length) return { unread_relevant_count: 0, open_relevant_count: 0 };

    const conversations = rows.map((r) => ({
      id: r.id,
      lastMessageAt: r.lastMessageAt,
    }));
    const states = await this.getViewerConversationStates(conversations, viewerUserId);

    let unread = 0;
    let open = 0;
    for (const c of rows) {
      const state = states.get(c.id);
      if (!state?.viewer_is_relevant) continue;
      if (c.status !== "resolved") open += 1;
      if (state.viewer_has_unread) unread += 1;
    }
    return { unread_relevant_count: unread, open_relevant_count: open };
  }

  // ---- Multi-participant conversations (Phase 2 / 2D) — purely additive, see
  // conversation_participants migration's comment: conversations.identityId
  // stays the unchanged "primary" identity for all existing threading logic. ----

  async addConversationParticipant(
    conversationId: string,
    participant: { identityId: string } | { userId: string },
  ): Promise<ConversationParticipant> {
    const isIdentity = "identityId" in participant;
    const [row] = await this.orm
      .insert(conversationParticipants)
      .values({
        conversationId,
        identityId: isIdentity ? participant.identityId : null,
        userId: isIdentity ? null : participant.userId,
        role: isIdentity ? "external" : "internal",
      })
      .returning();

    return row;
  }

  async removeConversationParticipant(conversationId: string, participantId: string): Promise<void> {
    await this.orm.delete(conversationParticipants).where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.id, participantId),
    ));
  }

  async listConversationParticipants(conversationId: string): Promise<ConversationParticipant[]> {
    return this.orm
      .select()
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
  }

  // ---- Conversation merging (Phase 7) — admin-triggered, closes the real
  // gap where mergeIdentities never re-points conversations.identityId,
  // leaving two simultaneously-open conversations for one canonical
  // resident. Mirrors the identity-merge pattern: messages are never
  // rewritten (see getConversationThread's chain-aware read above), only
  // tags/assignees/participants (cheap join rows) are physically moved. ----

  /** Physically moves tags/assignees/participants/personal-tags/read-states
   * from source into target - unlike messages, these are cheap join-table
   * rows, and moving them means every existing reader (comm-canoe's own
   * dashboard, listConversationTags/Assignees/Participants) keeps working
   * completely unmodified, with no new chain-aware read path needed for
   * these. conversation_participants has no plain unique index to upsert
   * against (its two unique indexes are partial, on identity_id/user_id
   * respectively) so it's deduped in application code instead.
   *
   * Read states get special handling: a plain upsert would let a stale
   * source cursor clobber a fresher target one (or vice versa) for the same
   * user, so both sides are read first and the newer last_read_at per user
   * wins - unread status must never regress across a merge. */
  private async moveConversationExtras(sourceId: string, targetId: string): Promise<void> {
    // One transaction. These five writes were five independent round trips,
    // and a failure partway left a merged conversation with some of its
    // extras moved and the rest still on a source that callers treat as gone.
    await this.orm.transaction(async (tx) => {
      const [
        sourceTags,
        sourceAssignees,
        sourceParticipants,
        targetParticipants,
        sourcePersonalTags,
        sourceReadStates,
        targetReadStates,
      ] = await Promise.all([
        tx.select({ tagId: conversationTags.tagId }).from(conversationTags)
          .where(eq(conversationTags.conversationId, sourceId)),
        tx.select({ userId: conversationAssignees.userId, assignedBy: conversationAssignees.assignedBy })
          .from(conversationAssignees).where(eq(conversationAssignees.conversationId, sourceId)),
        tx.select({
          identityId: conversationParticipants.identityId,
          userId: conversationParticipants.userId,
          role: conversationParticipants.role,
        }).from(conversationParticipants).where(eq(conversationParticipants.conversationId, sourceId)),
        tx.select({
          identityId: conversationParticipants.identityId,
          userId: conversationParticipants.userId,
        }).from(conversationParticipants).where(eq(conversationParticipants.conversationId, targetId)),
        tx.select({ userId: conversationPersonalTags.userId }).from(conversationPersonalTags)
          .where(eq(conversationPersonalTags.conversationId, sourceId)),
        tx.select().from(conversationReadStates)
          .where(eq(conversationReadStates.conversationId, sourceId)),
        tx.select().from(conversationReadStates)
          .where(eq(conversationReadStates.conversationId, targetId)),
      ]);

      // A participant is the same person whether they arrived as an identity
      // or a user, so dedup on both - inserting a duplicate would show one
      // person twice on the merged thread.
      const participantKey = (p: { identityId: string | null; userId: string | null }) =>
        `${p.identityId ?? ""}:${p.userId ?? ""}`;
      const existingParticipantKeys = new Set(targetParticipants.map(participantKey));
      const participantRows = sourceParticipants
        .filter((p) => !existingParticipantKeys.has(participantKey(p)))
        .map((p) => ({
          conversationId: targetId,
          identityId: p.identityId,
          userId: p.userId,
          role: p.role,
        }));

      // Target first, then source, keeping whichever cursor is later: a viewer
      // who had read further in one conversation must not be told the merged
      // thread is unread because the other side lagged.
      const readStateByUser = new Map<string, { lastReadAt: Date; lastReadMessageId: string | null }>();
      for (const row of [...targetReadStates, ...sourceReadStates]) {
        const existing = readStateByUser.get(row.userId);
        if (!existing || row.lastReadAt > existing.lastReadAt) {
          readStateByUser.set(row.userId, {
            lastReadAt: row.lastReadAt,
            lastReadMessageId: row.lastReadMessageId,
          });
        }
      }

      if (sourceTags.length) {
        await tx.insert(conversationTags)
          .values(sourceTags.map((t) => ({ conversationId: targetId, tagId: t.tagId })))
          .onConflictDoNothing();
      }

      if (sourceAssignees.length) {
        await tx.insert(conversationAssignees)
          .values(sourceAssignees.map((a) => ({
            conversationId: targetId, userId: a.userId, assignedBy: a.assignedBy,
          })))
          .onConflictDoUpdate({
            target: [conversationAssignees.conversationId, conversationAssignees.userId],
            set: { assignedBy: sql`excluded.assigned_by` },
          });
      }

      if (participantRows.length) {
        await tx.insert(conversationParticipants).values(participantRows);
      }

      if (sourcePersonalTags.length) {
        await tx.insert(conversationPersonalTags)
          .values(sourcePersonalTags.map((t) => ({ conversationId: targetId, userId: t.userId })))
          .onConflictDoNothing();
      }

      if (readStateByUser.size) {
        await tx.insert(conversationReadStates)
          .values([...readStateByUser.entries()].map(([userId, state]) => ({
            conversationId: targetId, userId, ...state,
          })))
          .onConflictDoUpdate({
            target: [conversationReadStates.conversationId, conversationReadStates.userId],
            set: {
              lastReadAt: sql`excluded.last_read_at`,
              lastReadMessageId: sql`excluded.last_read_message_id`,
            },
          });
      }
      // Inside the transaction with the copy, not after it. This is a move:
      // copy-then-delete as two units of work leaves the same rows on both
      // conversations if the second half fails, and a merged source is one
      // callers treat as gone - nothing would go back to reconcile it.
      await Promise.all([
        tx.delete(conversationTags).where(eq(conversationTags.conversationId, sourceId)),
        tx.delete(conversationAssignees).where(eq(conversationAssignees.conversationId, sourceId)),
        tx.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, sourceId)),
        tx.delete(conversationPersonalTags).where(eq(conversationPersonalTags.conversationId, sourceId)),
        tx.delete(conversationReadStates).where(eq(conversationReadStates.conversationId, sourceId)),
      ]);
    });
  }

  /** Signals comm-canoe's own dashboard (apps/web/src/components/inbox/
   * chat-realtime.tsx's useConversationRealtime, watching whichever
   * conversation is currently selected) that a conversation changed
   * structurally, so it refetches instead of waiting for a poll/reload.
   * Deliberately a distinct "updated" event rather than a reuse of the
   * "message" one - that one is web_chat-shaped and is only ever fired from
   * the live chat-widget's own session code (chat-session.ts); a merge/split
   * can affect a conversation of any channel, and the frontend listener
   * refetches either way, so a minimal, honestly-named event is simpler than
   * stretching a chat-specific shape to fit. Goes over HTTP to the bridge
   * rather than importing its hub directly, since that lives in a different
   * app and the two don't cross-import (same boundary Phase 5's notify
   * helpers respected). */
  private async broadcastConversationUpdated(conversationId: string): Promise<void> {
    await notifyDashboardConversation(conversationId, "updated");
  }

  /** Merges sourceId into targetId: both are resolved to canonical first
   * (so passing an already-merged id is a safe no-op-toward-correctness),
   * validated as belonging to the same tenant and the same identity
   * merge-chain (the only safeguard against combining two different
   * residents' conversations - deliberately narrow, see the migration's
   * header comment), then tags/assignees/participants are moved onto the
   * target and the source is marked `status: 'merged'` with
   * `merged_into_id` pointing at the target. Returns the canonical target
   * id so the caller can redirect there. */
  async mergeConversations(tenantId: TenantId, sourceId: string, targetId: string): Promise<string> {
    const [canonicalSourceId, canonicalTargetId] = await Promise.all([
      this.resolveConversationId(sourceId),
      this.resolveConversationId(targetId),
    ]);

    if (canonicalSourceId === canonicalTargetId) {
      throw new Error("These conversations are already merged.");
    }

    const conversations = await this.orm
      .select().from(conversationsTable)
      .where(inArray(conversationsTable.id, [canonicalSourceId, canonicalTargetId]));

    const source = conversations.find((c) => c.id === canonicalSourceId);
    const target = conversations.find((c) => c.id === canonicalTargetId);
    if (!source || !target) throw new Error("Conversation not found.");
    if (source.tenantId !== tenantId || target.tenantId !== tenantId) {
      throw new Error("Conversations do not belong to this tenant.");
    }

    const targetIdentityChain = await this.getIdentityMergeChainIds(target.identityId);
    if (!targetIdentityChain.includes(source.identityId)) {
      throw new Error("These conversations belong to different residents - merge identities first.");
    }

    await this.moveConversationExtras(canonicalSourceId, canonicalTargetId);

    const lastMessageAt =
      new Date(source.lastMessageAt) > new Date(target.lastMessageAt)
        ? source.lastMessageAt
        : target.lastMessageAt;

    await Promise.all([
      this.orm.update(conversationsTable)
        .set({ lastMessageAt })
        .where(eq(conversationsTable.id, canonicalTargetId)),
      this.orm.update(conversationsTable)
        .set({ status: "merged", mergedIntoId: canonicalTargetId })
        .where(eq(conversationsTable.id, canonicalSourceId)),
    ]);

    // Adjacent fix (Phase 8): merge combines message histories, so the
    // target's response_due_at/response_overdue_notified_at (only ever
    // recomputed above for last_message_at) can be wrong after a merge -
    // e.g. a genuinely-overdue conversation reading as cleared. Also emits
    // the live-update signal so comm-canoe's own dashboard reflects the
    // merge without waiting for a poll/reload - a raw UPDATE bypasses
    // appendMessage entirely, so nothing broadcasts otherwise.
    await this.recomputeConversationSla(tenantId, canonicalTargetId);
    await Promise.all([
      this.broadcastConversationUpdated(canonicalSourceId),
      this.broadcastConversationUpdated(canonicalTargetId),
    ]);

    return canonicalTargetId;
  }

  /** Splits sourceConversationId at splitMessageId: creates a new
   * conversation for the same identity/tenant and physically moves
   * splitMessageId plus every message chronologically after it into it.
   * Unlike merge (messages left in place, read via chain-walk), the moved
   * set here is typically small/recent, and the UX goal is that the new
   * conversation visibly contains the message that started the new topic
   * - a read-only approach would need both sides to filter by time on
   * every read, real complexity merge never needed. Re-resolves
   * sourceConversationId immediately before the move and aborts if it's
   * changed (e.g. merged away by a concurrent request) - cheap,
   * proportionate given how rare and human-paced this operation is; no new
   * locking infrastructure. Returns the new conversation's id. */
  async splitConversation(
    tenantId: TenantId,
    sourceConversationId: string,
    splitMessageId: string,
    actorUserId: string | null,
    options?: { triggerType?: "admin" | "ai"; reasoning?: string | null },
  ): Promise<string> {
    const canonicalSourceId = await this.resolveConversationId(sourceConversationId);

    const [source] = await this.orm
      .select().from(conversationsTable)
      .where(eq(conversationsTable.id, canonicalSourceId)).limit(1);
    if (!source || source.tenantId !== tenantId) {
      throw new Error("Conversation not found.");
    }

    // Chain-aware, not a literal equality check: a message that arrived via
    // an earlier merge still carries its pre-merge conversation_id (merge
    // never rewrites messages.conversationId, unlike split) - getConversationThread
    // already reads across the whole chain, so ownership here has to match.
    const chainIds = await this.getConversationMergeChainIds(canonicalSourceId);

    const [splitMessage] = await this.orm
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        createdAt: messages.createdAt,
      })
      .from(messages).where(eq(messages.id, splitMessageId)).limit(1);
    if (!splitMessage || !chainIds.includes(splitMessage.conversationId)) {
      throw new Error("That message does not belong to this conversation.");
    }

    const [target] = await this.orm
      .insert(conversationsTable)
      .values({ tenantId, identityId: source.identityId, status: "open" })
      .returning();

    const recheckId = await this.resolveConversationId(sourceConversationId);
    if (recheckId !== canonicalSourceId) {
      await this.orm.delete(conversationsTable).where(eq(conversationsTable.id, target.id));
      throw new Error("This conversation was merged into another one - refresh and try again.");
    }

    const movedMessages = await this.orm
      .update(messages)
      .set({ conversationId: target.id })
      .where(and(
        inArray(messages.conversationId, chainIds),
        gte(messages.createdAt, splitMessage.createdAt),
      ))
      .returning({ id: messages.id, createdAt: messages.createdAt });

    const movedIds = movedMessages.map((m) => m.id);
    const targetLastMessageAt = movedMessages.reduce(
      (latest, m) => (m.createdAt > latest ? m.createdAt : latest),
      splitMessage.createdAt,
    );

    if (movedIds.length) {
      // Table is "live_transfers" (renamed from call_transfers in
      // 20250621140000_web_chat_and_live_transfer.sql) - has two
      // independent pointers to the same event (conversation_id NOT NULL,
      // message_id nullable); left unfixed they'd actively disagree, not
      // just go stale, once the referenced message moves.
      await this.orm
        .update(liveTransfers)
        .set({ conversationId: target.id })
        .where(inArray(liveTransfers.messageId, movedIds));
    }

    const [latestRemaining] = await this.orm
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(inArray(messages.conversationId, chainIds))
      .orderBy(desc(messages.createdAt)).limit(1);

    await Promise.all([
      this.orm.update(conversationsTable)
        .set({ lastMessageAt: latestRemaining?.createdAt ?? source.createdAt })
        .where(eq(conversationsTable.id, canonicalSourceId)),
      this.orm.update(conversationsTable)
        .set({ lastMessageAt: targetLastMessageAt })
        .where(eq(conversationsTable.id, target.id)),
    ]);

    await Promise.all([
      this.recomputeConversationSla(tenantId, canonicalSourceId),
      this.recomputeConversationSla(tenantId, target.id),
    ]);

    const logError = await this.orm.insert(conversationSplits).values({
      tenantId,
      sourceConversationId: canonicalSourceId,
      targetConversationId: target.id,
      splitMessageId,
      triggerType: options?.triggerType ?? "admin",
      triggeredByUserId: actorUserId,
      reasoning: options?.reasoning ?? null,
    }).then(() => null).catch((e: unknown) => e);
    if (logError) throw logError;

    await Promise.all([
      this.broadcastConversationUpdated(canonicalSourceId),
      this.broadcastConversationUpdated(target.id),
    ]);

    return target.id;
  }

  // ---- AI-automated conversation routing (Phase 9) ----

  async listPendingTopicCheckMessageIds(limit: number): Promise<string[]> {
    const rows = await this.orm
      .select({ id: messages.id }).from(messages)
      .where(eq(messages.topicCheckStatus, "pending"))
      .orderBy(asc(messages.createdAt)).limit(limit);
    return rows.map((row) => row.id);
  }

  /** Atomic claim, mirroring claimScheduledMessage - required here (unlike
   * applyToneReviewResult's plain conditional update) because the dangerous
   * side effect (splitConversation, non-idempotent) happens before any
   * "done" write, so a check-only-on-final-write wouldn't stop two
   * overlapping worker ticks from both acting on the same message. Found by
   * a design-review pass, not by testing. */
  async claimTopicCheckMessage(messageId: string): Promise<Message | null> {
    const [data] = await this.orm
      .update(messages)
      .set({ topicCheckStatus: "processing" })
      .where(and(eq(messages.id, messageId), eq(messages.topicCheckStatus, "pending")))
      .returning();
    return data ?? null;
  }

  /** Terminal write for a claimed message, regardless of outcome (split or
   * not) - topic_check_status lives on the message row, which travels with
   * it even after splitConversation moves it to a different conversation,
   * so this always needs its own call, not something splitConversation
   * does implicitly. */
  async markTopicCheckReviewed(messageId: string): Promise<void> {
    await this.orm.update(messages)
      .set({ topicCheckStatus: "reviewed" }).where(eq(messages.id, messageId));
  }

  /** Cheap circuit breaker using data already being written - checked
   * before an AI-triggered split, not a defensive guard elsewhere. A wrong
   * *individual* auto-split is cheap to fix via merge, but nothing else
   * would tell an admin "the classifier is over-triggering on this
   * tenant," so this caps the blast radius of a systematic misfire rather
   * than relying on per-instance reversibility alone. */
  async countRecentAiSplits(tenantId: TenantId, sinceMinutes: number): Promise<number> {
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    const [row] = await this.orm
      .select({ value: count() })
      .from(conversationSplits)
      .where(and(
        eq(conversationSplits.tenantId, tenantId),
        eq(conversationSplits.triggerType, "ai"),
        gte(conversationSplits.createdAt, since),
      ));
    return row?.value ?? 0;
  }

  /** "How did this conversation come to exist via a split, if it did" -
   * looks up the split record where this conversation is the *target*.
   * Surfaced on the conversation GET route so reside can show a "split off
   * automatically / by an admin" banner - the minimal admin-visibility
   * mitigation for having no per-split approval gate. */
  async getConversationSplitOrigin(conversationId: string): Promise<{
    sourceConversationId: string;
    triggerType: "admin" | "ai";
    reasoning: string | null;
    createdAt: string;
  } | null> {
    const [data] = await this.orm
      .select({
        source_conversation_id: conversationSplits.sourceConversationId,
        trigger_type: conversationSplits.triggerType,
        reasoning: conversationSplits.reasoning,
        created_at: conversationSplits.createdAt,
      })
      .from(conversationSplits)
      .where(eq(conversationSplits.targetConversationId, conversationId)).limit(1);
    if (!data) return null;
    return {
      sourceConversationId: data.source_conversation_id,
      triggerType: data.trigger_type as "admin" | "ai",
      reasoning: data.reasoning,
      createdAt: data.created_at.toISOString(),
    };
  }

  /** Surfaces "this resident's other conversations" for the merge UI -
   * resolves to canonical, walks the resident's full identity merge-chain
   * (catching the exact gap found in research: two identities that later
   * merged, each with their own pre-existing open conversation), and
   * excludes anything already merged into this one. */
  async listRelatedConversations(tenantId: TenantId, conversationId: string): Promise<ConversationWithIdentity[]> {
    const canonicalId = await this.resolveConversationId(conversationId);

    const [conversation] = await this.orm
      .select({ identityId: conversationsTable.identityId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, canonicalId)).limit(1);
    if (!conversation) return [];

    const [identityIds, ownChainIds] = await Promise.all([
      this.getIdentityMergeChainIds(conversation.identityId),
      this.getConversationMergeChainIds(canonicalId),
    ]);

    const candidates = await this.orm
      .select().from(conversationsTable)
      .where(and(
        eq(conversationsTable.tenantId, tenantId),
        inArray(conversationsTable.identityId, identityIds),
        ne(conversationsTable.status, "merged"),
      ))
      .orderBy(desc(conversationsTable.lastMessageAt));

    const ownChainSet = new Set(ownChainIds);
    const related = (candidates ?? []).filter((c) => !ownChainSet.has(c.id));
    if (!related.length) return [];

    const relatedIdentityIds = [...new Set(related.map((c) => c.identityId))];
    const identityRows = await this.orm
      .select()
      .from(identities)
      .where(inArray(identities.id, relatedIdentityIds));
    const identityMap = new Map(identityRows.map((i) => [i.id, i]));
    const extrasMap = await this.getConversationExtrasMap(related.map((c) => c.id));

    return related.map((c) => ({
      ...c,
      identity: identityMap.get(c.identityId)!,
      ...(extrasMap.get(c.id) ?? { participants: [], tags: [], assignees: [] }),
    }));
  }

  // ---- Ticketing/SLA (Phase 2 / 2E) — schema + manual setters only; the
  // scan-for-overdue-conversations job is Phase 5's job. ----

  async updateConversationPriority(conversationId: string, priority: ConversationPriority) {
    const [updated] = await this.orm
      .update(conversationsTable)
      .set({ priority })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return updated;
  }

  async setConversationResponseDueAt(conversationId: string, dueAt: string | null) {
    const [updated] = await this.orm
      .update(conversationsTable)
      .set({ responseDueAt: dueAt ? new Date(dueAt) : null })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return updated;
  }

  /** Best-effort snapshot of overdue conversations - not itself a claim, see
   * claimOverdueConversationNotification for the atomic per-row step. Same
   * shape as listDueScheduledMessageIds (Phase 3). */
  async listOverdueConversationIds(limit: number): Promise<string[]> {
    const data = await this.orm
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(
        isNotNull(conversationsTable.responseDueAt),
        lte(conversationsTable.responseDueAt, new Date()),
        isNull(conversationsTable.responseOverdueNotifiedAt),
      ))
      .orderBy(asc(conversationsTable.responseDueAt))
      .limit(limit);

    return data.map((row) => row.id);
  }

  /** Atomically claims one overdue conversation for notification: the
   * conditional `response_overdue_notified_at IS NULL` in the WHERE clause
   * is a single-row Postgres UPDATE, race-safe against a concurrent worker
   * tick without extra locking - same pattern as claimScheduledMessage
   * (Phase 3). Returns null if another tick already claimed it, or if a new
   * response cleared response_overdue_notified_at back to null via the
   * outbound-message trigger branch racing in first (impossible here since
   * that branch sets it to NULL, not away-from-NULL, so this can only ever
   * return null on a genuine double-claim, not a false negative). */
  async claimOverdueConversationNotification(conversationId: string): Promise<Conversation | null> {
    // The null predicate is the claim: two notification workers racing, only
    // one matches an unnotified row, so an overdue conversation is announced
    // once rather than once per replica.
    const [data] = await this.orm
      .update(conversationsTable)
      .set({ responseOverdueNotifiedAt: new Date() })
      .where(and(
        eq(conversationsTable.id, conversationId),
        isNull(conversationsTable.responseOverdueNotifiedAt),
      ))
      .returning();
    return data;
  }

  /** Structurally replicates update_conversation_response_due_at's
   * (Phase 5) AFTER INSERT trigger logic, but re-derived from a
   * conversation's *current* message set rather than incrementally -
   * needed because Phase 8's split (and, as an adjacent fix, Phase 7's
   * merge) restructure which messages belong to a conversation via raw
   * UPDATEs that never fire an INSERT-only trigger. Resets
   * response_overdue_notified_at to null whenever there's an unanswered
   * inbound tail, even if it was already set before the restructure -
   * deliberately erring toward one possibly-redundant re-notification over
   * silently suppressing a legitimate one for a conversation whose
   * message set just changed underneath it. */
  async recomputeConversationSla(tenantId: TenantId, conversationId: string): Promise<void> {
    // Chain-aware: a conversation with merge history has messages whose raw
    // conversation_id still points at an earlier, merged-away conversation
    // (merge never rewrites messages.conversationId) - the true message
    // set has to be read the same way getConversationThread reads it.
    const chainIds = await this.getConversationMergeChainIds(conversationId);

    const [latestExternal] = await this.orm
      .select({ direction: messages.direction, createdAt: messages.createdAt })
      .from(messages)
      .where(and(
        inArray(messages.conversationId, chainIds),
        eq(messages.visibility, "external"),
      ))
      .orderBy(desc(messages.createdAt)).limit(1);

    if (!latestExternal || latestExternal.direction === "outbound") {
      await this.orm.update(conversationsTable)
        .set({ responseDueAt: null, responseOverdueNotifiedAt: null })
        .where(eq(conversationsTable.id, conversationId));
      return;
    }

    // latestExternal is inbound - find the start of the current unanswered
    // streak: the earliest inbound-external message after the most recent
    // outbound-external one, or the earliest inbound-external message
    // overall if there's never been an outbound one.
    const [lastOutbound] = await this.orm
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(
        inArray(messages.conversationId, chainIds),
        eq(messages.visibility, "external"),
        eq(messages.direction, "outbound"),
      ))
      .orderBy(desc(messages.createdAt)).limit(1);

    // The unanswered streak starts at the first inbound external message after
    // the last outbound one - or at the earliest inbound message if there has
    // never been a reply.
    const streakConditions = [
      inArray(messages.conversationId, chainIds),
      eq(messages.visibility, "external"),
      eq(messages.direction, "inbound"),
    ];
    if (lastOutbound) {
      streakConditions.push(gt(messages.createdAt, lastOutbound.createdAt));
    }

    const [streakStart] = await this.orm
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(...streakConditions))
      .orderBy(asc(messages.createdAt))
      .limit(1);
    if (!streakStart) return;

    const settings = await this.getTenantSettings(tenantId);
    const windowMinutes = settings?.defaultResponseWindowMinutes ?? 60;
    const dueAt = new Date(streakStart.createdAt.getTime() + windowMinutes * 60_000);

    await this.orm.update(conversationsTable)
      .set({ responseDueAt: dueAt, responseOverdueNotifiedAt: null })
      .where(eq(conversationsTable.id, conversationId));
  }

  /** Phase 3's kanban board drag-between-columns write path. Prior to
   * Phase 8, a resolved/pending -> open transition could hit
   * conversations_one_open_per_identity if the resident already had a
   * different open conversation, and that was caught here and turned into
   * a clean error pointing at the merge feature. Phase 8 drops that unique
   * index entirely (splitting requires two simultaneously-open
   * conversations for one resident, an intentional, supported state now,
   * not a bug) - the special-case catch is removed accordingly, not left
   * as dead code. Reopening a resolved conversation may now produce a
   * second open conversation for the resident, exactly as an intentional
   * split already does. */
  async updateConversationStatus(
    conversationId: string,
    status: "open" | "pending" | "resolved",
  ): Promise<Conversation> {
    const [updated] = await this.orm
      .update(conversationsTable)
      .set({ status })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return updated;
  }

  async getResolvedConversationExamples(tenantId: TenantId, limit = 5) {
    const conversations = await this.orm
      .select({ id: conversationsTable.id, summary: conversationsTable.summary })
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.status, "resolved"),
        isNotNull(conversationsTable.summary),
      ))
      .orderBy(desc(conversationsTable.lastMessageAt)).limit(limit);

    if (!conversations.length) return [];

    const ids = conversations.map((c) => c.id);
    const exampleMessages = await this.orm
      .select({
        conversationId: messages.conversationId,
        body: messages.body,
        direction: messages.direction,
        senderType: messages.senderType,
      })
      .from(messages).where(inArray(messages.conversationId, ids));

    return conversations.map((c) => {
      const msgs = exampleMessages.filter((m) => m.conversationId === c.id);
      const sampleReply =
        msgs.find((m) => m.direction === "outbound" && m.senderType === "internal_user")
          ?.body ?? "";
      return { summary: c.summary, sampleReply };
    });
  }

  async getTenantSettings(tenantId: TenantId) {
    const [settings] = await this.orm
      .select().from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId)).limit(1);
    return settings ?? null;
  }

  /** First application-layer write path to tenant_settings - previously only
   * reachable via the tenant_settings_update_admin RLS policy with no method
   * calling it. Plain upsert-by-tenant_id, same idiom as every other settings
   * setter in this codebase. */
  async updateTenantSettings(
    tenantId: TenantId,
    patch: Partial<Omit<TenantSettings, "tenantId" | "updatedAt">>,
  ): Promise<TenantSettings> {
    const [settings] = await this.orm
      .insert(tenantSettings)
      .values({ tenantId, ...patch, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: { ...patch, updatedAt: new Date() },
      })
      .returning();
    return settings;
  }

  async getUserTenants(userId: string) {
    const memberships = await this.orm
      .select({
        tenant_id: userTenantMemberships.tenantId,
        role: userTenantMemberships.role,
      })
      .from(userTenantMemberships)
      .where(eq(userTenantMemberships.userId, userId));
    if (!memberships.length) return [];

    const tenantIds = memberships.map((m) => m.tenant_id);
    const tenantRows = await this.orm
      .select().from(tenants).where(inArray(tenants.id, tenantIds));
    const tenantMap = new Map(tenantRows.map((t) => [t.id, t]));

    return memberships.map((row) => ({
      role: row.role,
      tenant: tenantMap.get(row.tenant_id)!,
    }));
  }

  // ---- Knowledge documents / RAG ingestion (Phase 10) ----

  /** Tenant-scoped cap check, done before insert (not just documented as a
   * default) - unlike suggestReply's existing per-click AI cost, document
   * ingestion runs unattended via a background worker, so an uncapped
   * tenant could drive unbounded embedding-API spend. reside enforces this
   * too before ever calling here (defense in depth), but this is the real
   * boundary since a client can call this endpoint directly. */
  async countTenantDocuments(tenantId: TenantId): Promise<number> {
    const [row] = await this.orm
      .select({ value: count() }).from(documents)
      .where(eq(documents.tenantId, tenantId));
    return row?.value ?? 0;
  }

  async countTenantChunks(tenantId: TenantId): Promise<number> {
    const [row] = await this.orm
      .select({ value: count() }).from(documentChunks)
      .where(eq(documentChunks.tenantId, tenantId));
    return row?.value ?? 0;
  }

  async createDocument(input: {
    tenantId: TenantId;
    filename: string;
    contentText: string;
    extractor: string;
    pageCount?: number | null;
    uploadedBy?: string | null;
  }): Promise<Document> {
    const [document] = await this.orm
      .insert(documents)
      .values({
        tenantId: input.tenantId,
        filename: input.filename,
        contentText: input.contentText,
        extractor: input.extractor,
        pageCount: input.pageCount ?? null,
        uploadedBy: input.uploadedBy ?? null,
      })
      .returning();

    return document;
  }

  async listDocumentsForTenant(tenantId: TenantId): Promise<Document[]> {
    return this.orm
      .select().from(documents)
      .where(eq(documents.tenantId, tenantId))
      .orderBy(desc(documents.createdAt));
  }

  async getDocument(tenantId: TenantId, documentId: string): Promise<Document | null> {
    // Scoped by tenant as well as id: a document id is not proof of ownership.
    const [document] = await this.orm
      .select().from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)))
      .limit(1);
    return document ?? null;
  }

  /** document_chunks.document_id has ON DELETE CASCADE (migration
   * 20250701001500) - deleting the document row cleans up its chunks
   * automatically, no app-layer delete-then-delete needed. */
  async deleteDocument(tenantId: TenantId, documentId: string): Promise<void> {
    await this.orm.delete(documents).where(and(
      eq(documents.id, documentId),
      eq(documents.tenantId, tenantId),
    ));
  }

  async listPendingDocumentIds(limit: number): Promise<string[]> {
    const rows = await this.orm
      .select({ id: documents.id }).from(documents)
      .where(eq(documents.status, "pending"))
      .orderBy(asc(documents.createdAt)).limit(limit);
    return rows.map((row) => row.id);
  }

  /** Same atomic-claim shape as claimTopicCheckMessage (Phase 9) - chunking
   * + embedding is the non-idempotent side effect here, so a plain
   * conditional update on the terminal write wouldn't stop two overlapping
   * worker ticks from both ingesting the same document. */
  async claimPendingDocument(documentId: string): Promise<Document | null> {
    const [claimed] = await this.orm
      .update(documents)
      .set({ status: "processing", updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.status, "pending")))
      .returning();
    return claimed ?? null;
  }

  async insertDocumentChunks(chunks: NewDocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.orm.insert(documentChunks).values(chunks);
  }

  async markDocumentReady(documentId: string): Promise<void> {
    await this.orm
      .update(documents)
      .set({ status: "ready", failureReason: null, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  }

  /** Never left stuck at pending/processing - every ingestion failure path
   * (embedding call throws, cap exceeded mid-ingestion, claimed row deleted
   * mid-tick) ends here with a reason, matching every other worker's
   * safety-net convention in this codebase. */
  async markDocumentFailed(documentId: string, reason: string): Promise<void> {
    await this.orm
      .update(documents)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  }

  /** Exact (not approximate/HNSW) cosine similarity scan via the
   * match_document_chunks RPC, scoped by tenant_id - see the RAG migrations'
   * header comments for why no index backs this at launch. Over-fetches
   * (fetchMultiplier * topK) and applies a diversity cap client-side so
   * near-duplicate adjacent chunks from one document can't crowd out other
   * sources in the final top-K. */
  async findSimilarChunks(
    tenantId: TenantId,
    queryEmbedding: number[],
    options?: { topK?: number; maxPerDocument?: number; fetchMultiplier?: number },
  ): Promise<Array<{ id: string; documentId: string; heading: string | null; content: string }>> {
    const topK = options?.topK ?? 5;
    const maxPerDocument = options?.maxPerDocument ?? 3;
    const fetchMultiplier = options?.fetchMultiplier ?? 4;

    // The embedding is passed as a pgvector literal - a bare JS array binds as
    // a Postgres array, which the vector parameter will not accept.
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;
    const matched = (await this.orm.execute(
      sql`SELECT * FROM match_document_chunks(
        ${tenantId}::uuid,
        ${embeddingLiteral}::vector,
        ${topK * fetchMultiplier}::int
      )`,
    )) as { rows: Array<{ id: string; document_id: string; heading: string | null; content: string }> };
    const data = matched.rows;

    const perDocumentCount = new Map<string, number>();
    const result: Array<{ id: string; documentId: string; heading: string | null; content: string }> = [];
    for (const row of data ?? []) {
      if (result.length >= topK) break;
      const count = perDocumentCount.get(row.document_id) ?? 0;
      if (count >= maxPerDocument) continue;
      perDocumentCount.set(row.document_id, count + 1);
      result.push({ id: row.id, documentId: row.document_id, heading: row.heading, content: row.content });
    }
    return result;
  }

  // ---- Voicemail transcription (Phase 11) ----

  /** Atomically claims a voicemail for transcription: pending -> transcribing.
   * Returns false when another replica got there first, so the expensive
   * OpenAI call happens exactly once per voicemail across all replicas. */
  async claimVoicemailTranscription(messageId: string): Promise<boolean> {
    const claimed = await this.orm
      .update(messages)
      .set({ transcriptionStatus: "transcribing" })
      .where(and(eq(messages.id, messageId), eq(messages.transcriptionStatus, "pending")))
      .returning({ id: messages.id });
    return claimed.length > 0;
  }

  async listPendingVoicemailTranscriptionMessageIds(limit: number): Promise<string[]> {
    const rows = await this.orm
      .select({ id: messages.id }).from(messages)
      .where(eq(messages.transcriptionStatus, "pending"))
      .orderBy(asc(messages.createdAt)).limit(limit);
    return rows.map((row) => row.id);
  }

  /** Plain conditional update, not an atomic claim like Phase 9/10's workers
   * need - re-running a transcription on the same audio wastes an API call
   * but doesn't corrupt state (unlike splitConversation or document
   * chunking, which are non-idempotent side effects that must happen
   * exactly once), so the simpler check-only-on-write pattern (mirroring
   * applyToneReviewResult) is sufficient here. */
  async updateMessageTranscription(messageId: string, body: string): Promise<void> {
    await this.orm
      .update(messages)
      .set({ body, transcript: body, transcriptionStatus: "ready" })
      .where(and(eq(messages.id, messageId), eq(messages.transcriptionStatus, "pending")));
  }

  /** Never left stuck at pending - mirrors every other worker's safety-net
   * convention (markDocumentFailed, applyToneReviewResult's default-to-
   * flagged, markTopicCheckReviewed). */
  async markMessageTranscriptionFailed(messageId: string, reason: string): Promise<void> {
    await this.orm
      .update(messages)
      .set({ transcriptionStatus: "failed", transcriptionFailureReason: reason })
      .where(and(eq(messages.id, messageId), eq(messages.transcriptionStatus, "pending")));
  }

  private async findIdentityByPhone(tenantId: TenantId, phone: string) {
    const [identity] = await this.orm
      .select()
      .from(identities)
      .where(and(
        eq(identities.tenantId, tenantId),
        eq(identities.phone, phone),
        isNull(identities.mergedIntoId),
      ))
      .limit(1);
    return identity ?? null;
  }

  private async findIdentityByEmail(tenantId: TenantId, email: string) {
    const [identity] = await this.orm
      .select()
      .from(identities)
      .where(and(
        eq(identities.tenantId, tenantId),
        eq(identities.email, email),
        isNull(identities.mergedIntoId),
      ))
      .limit(1);
    return identity ?? null;
  }

  private async mergeIdentities(
    tenantId: TenantId,
    keepId: string,
    mergeId: string,
    matchedOn: "phone" | "email",
  ) {
    const canonicalKeep = await this.resolveIdentityId(keepId);
    const canonicalMerge = await this.resolveIdentityId(mergeId);
    if (canonicalKeep === canonicalMerge) return;

    await this.orm
      .update(identities)
      .set({ mergedIntoId: canonicalKeep })
      .where(eq(identities.id, canonicalMerge));

    await this.orm.insert(identityMergeLogs).values({
      tenantId,
      identityAId: canonicalKeep,
      identityBId: canonicalMerge,
      matchedOn,
      mergedBy: "system",
    });
  }

  private async resolveIdentityId(identityId: string): Promise<string> {
    const result = (await this.orm.execute(
      sql`SELECT resolve_identity_id(${identityId}::uuid) AS id`,
    )) as { rows: Array<{ id: string }> };
    return result.rows[0].id;
  }

  private async getCanonicalIdentity(identityId: string): Promise<Identity> {
    const canonicalId = await this.resolveIdentityId(identityId);
    const [identity] = await this.orm
      .select()
      .from(identities)
      .where(eq(identities.id, canonicalId))
      .limit(1);
    if (!identity) throw new Error(`Unknown identity: ${canonicalId}`);
    return identity;
  }
}

export function createDomainService(ormOverride?: Db) {
  return new DomainService(ormOverride);
}

export * from "./chat-session";
export * from "./dashboard-token";
