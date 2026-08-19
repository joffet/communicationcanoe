import type {
  AppendMessageInput,
  AnonymousIdentityInput,
  ConvertIdentityInput,
  ConversationFilters,
  IdentityContact,
  LogLiveTransferInput,
} from "@communication-canoe/shared";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { createDb, type Db } from "../db";
import {
  conversationReadStates,
  messages,
  outboundBatchRecipients,
  outboundBatches,
} from "../schema";
import type { AppSupabaseClient } from "../client";
import { createServiceClient, normalizeEmail, normalizePhone } from "../client";
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
  DocumentChunkInsert,
  Identity,
  LiveTransfer,
  Message,
  MessageDeliveryStatus,
  OutboundBatch,
  OutboundBatchRecipient,
  Tag,
  Team,
  Tenant,
  TenantSettingsRow,
} from "../types";

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
   * `db` is supabase-js; `orm` is Drizzle. Both talk to the same Postgres
   * during the migration - DATABASE_URL is the database supabase-js reaches
   * through PostgREST - so a converted method reads exactly the rows the
   * unconverted ones do, and methods can move across one at a time instead of
   * in one cutover.
   *
   * That also separates two changes that are easy to conflate: leaving
   * supabase-js, and leaving Supabase. This is the first. Moving to PlanetScale
   * afterwards is a connection string.
   *
   * Lazy rather than constructed here: most call sites never touch a converted
   * method, and building a pool for them would open connections nothing uses.
   * Tests pass their own handle - a pglite instance - through the second
   * argument.
   */
  constructor(
    private db: AppSupabaseClient,
    ormOverride?: Db,
  ) {
    this.#orm = ormOverride;
  }

  protected get orm(): Db {
    return (this.#orm ??= createDb());
  }

  async resolveTenantByPhone(phone: string): Promise<Tenant | null> {
    const normalized = normalizePhone(phone);
    const { data, error } = await this.db
      .from("tenants")
      .select("*")
      .eq("twilio_number", normalized)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;

    const { data: alt, error: altError } = await this.db
      .from("tenants")
      .select("*")
      .eq("twilio_number", phone)
      .maybeSingle();

    if (altError) throw altError;
    return alt;
  }

  async resolveTenantByEmail(email: string): Promise<Tenant | null> {
    const normalized = normalizeEmail(email);
    const { data, error } = await this.db
      .from("tenants")
      .select("*")
      .eq("inbound_email_address", normalized)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async resolveTenantByWidgetKey(key: string): Promise<Tenant | null> {
    const { data, error } = await this.db
      .from("tenants")
      .select("*")
      .eq("chat_widget_key", key)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async findOrCreateAnonymousIdentity(
    tenantId: string,
    input: AnonymousIdentityInput,
  ): Promise<Identity> {
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const name = input.name?.trim() || undefined;

    if (email) {
      return this.findOrCreateIdentity(tenantId, { email, name });
    }

    const { data, error } = await this.db
      .from("identities")
      .insert({
        tenant_id: tenantId,
        phone: null,
        email: null,
        name: name ?? null,
        is_anonymous: true,
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async convertIdentity(
    identityId: string,
    tenantId: string,
    input: ConvertIdentityInput,
    convertedBy: "system" | "user" = "system",
    convertedByUserId?: string,
  ): Promise<Identity> {
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const name = input.name?.trim() || undefined;

    const { data: existing, error: fetchError } = await this.db
      .from("identities")
      .select("*")
      .eq("id", identityId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError) throw fetchError;

    const { data, error } = await this.db
      .from("identities")
      .update({
        phone: phone ?? existing.phone,
        email: email ?? existing.email,
        name: name ?? existing.name,
        is_anonymous: false,
      })
      .eq("id", identityId)
      .select("*")
      .single();

    if (error) throw error;

    await this.db.from("identity_conversion_logs").insert({
      tenant_id: tenantId,
      identity_id: identityId,
      converted_by: convertedBy,
      converted_by_user_id: convertedByUserId ?? null,
      captured_name: name ?? existing.name,
      captured_email: email ?? existing.email,
      captured_phone: phone ?? existing.phone,
    });

    return data;
  }

  async logLiveTransfer(input: LogLiveTransferInput): Promise<LiveTransfer> {
    const { data, error } = await this.db
      .from("live_transfers")
      .insert({
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        channel: input.channel,
        attempted_user_id: input.attemptedUserId ?? null,
        message_id: input.messageId ?? null,
        outcome: input.outcome,
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async updateLiveTransferOutcome(
    transferId: string,
    outcome: LiveTransfer["outcome"],
    attemptedUserId?: string,
  ): Promise<LiveTransfer> {
    const patch: Partial<LiveTransfer> = { outcome };
    if (attemptedUserId) patch.attempted_user_id = attemptedUserId;

    const { data, error } = await this.db
      .from("live_transfers")
      .update(patch)
      .eq("id", transferId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async assignConversationUser(conversationId: string, userId: string | null) {
    const { data, error } = await this.db
      .from("conversations")
      .update({ assigned_user_id: userId })
      .eq("id", conversationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  createChatSessionToken(
    tenantId: string,
    conversationId: string,
    identityId: string,
  ): string {
    return createChatSessionToken({ tenantId, conversationId, identityId });
  }

  async resumeConversationBySessionToken(
    tenantId: string,
    sessionToken: string,
  ): Promise<{ conversation: Conversation; identity: Identity } | null> {
    const payload = verifyChatSessionToken(sessionToken);
    if (!payload || payload.tenantId !== tenantId) return null;

    const thread = await this.getConversationThread(payload.conversationId);
    if (!thread || thread.tenant_id !== tenantId) return null;
    if (thread.status !== "open") return null;

    // Phase 8: a pinned conversation isn't itself broken by having been
    // split (it still exists, still open, per the status check above) -
    // but the resident's next message should continue wherever the newer
    // topic now lives. Single-hop only (not a recursive chain-walk like
    // merge's resolve_conversation_id) - a session surviving through two
    // chained splits of the same lineage is a narrow enough edge case to
    // leave as an accepted v1 gap.
    const { data: latestSplit, error: splitError } = await this.db
      .from("conversation_splits")
      .select("target_conversation_id")
      .eq("source_conversation_id", thread.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (splitError) throw splitError;

    if (latestSplit) {
      const splitTarget = await this.getConversationThread(latestSplit.target_conversation_id);
      if (splitTarget && splitTarget.status === "open") {
        return { conversation: splitTarget, identity: splitTarget.identity };
      }
    }

    return { conversation: thread, identity: thread.identity };
  }

  async getOnCallUsers(tenantId: string, teamId?: string | null) {
    let teamIds: string[] = [];
    if (teamId) {
      teamIds = [teamId];
    } else {
      const teams = await this.getTeamsForTenant(tenantId);
      teamIds = teams.map((t) => t.id);
    }
    if (!teamIds.length) return [];

    const { data: memberships, error } = await this.db
      .from("team_memberships")
      .select("user_id, team_id, is_on_call")
      .in("team_id", teamIds)
      .eq("is_on_call", true);

    if (error) throw error;
    if (!memberships?.length) return [];

    const userIds = [...new Set(memberships.map((m) => m.user_id))];
    const { data: users, error: userError } = await this.db
      .from("users")
      .select("*")
      .in("id", userIds)
      .eq("available_for_calls", true);

    if (userError) throw userError;
    return users ?? [];
  }

  async findOrCreateIdentity(
    tenantId: string,
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
        await this.db.from("identities").update({ phone }).eq("id", existing.id);
        existing.phone = phone;
      }
      if (email && !existing.email) {
        await this.db.from("identities").update({ email }).eq("id", existing.id);
        existing.email = email;
      }
      if (contact.name && !existing.name) {
        await this.db.from("identities").update({ name: contact.name }).eq("id", existing.id);
        existing.name = contact.name;
      }
      if (contact.resideResidentId && !existing.reside_resident_id) {
        await this.db
          .from("identities")
          .update({ reside_resident_id: contact.resideResidentId })
          .eq("id", existing.id);
        existing.reside_resident_id = contact.resideResidentId;
      }
      return this.getCanonicalIdentity(existing.id);
    }

    const { data, error } = await this.db
      .from("identities")
      .insert({
        tenant_id: tenantId,
        phone: phone ?? null,
        email: email ?? null,
        name: contact.name ?? null,
        reside_resident_id: contact.resideResidentId ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
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
    tenantId: string,
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
    tenantId: string,
    identityId: string,
    context?: { channel?: string; subject?: string },
  ): Promise<{ conversation: Conversation; isStale: boolean }> {
    const canonicalId = await this.resolveIdentityId(identityId);
    const identityChainIds = await this.getIdentityMergeChainIds(canonicalId);

    const { data: openCandidates, error: openError } = await this.db
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("identity_id", identityChainIds)
      .eq("status", "open")
      .order("last_message_at", { ascending: false });
    if (openError) throw openError;

    const candidates = openCandidates ?? [];

    if (candidates.length === 0) {
      const { data, error } = await this.db
        .from("conversations")
        .insert({ tenant_id: tenantId, identity_id: canonicalId, status: "open" })
        .select("*")
        .single();
      if (error) throw error;
      return { conversation: data, isStale: false };
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
    const stalenessMinutes = settings?.conversation_staleness_minutes ?? 1440;
    const staleBefore = Date.now() - stalenessMinutes * 60_000;
    const isStale = new Date(selected.last_message_at).getTime() < staleBefore;

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
    const { data: recentMessages, error } = await this.db
      .from("messages")
      .select("conversation_id, subject, created_at")
      .in("conversation_id", candidateIds)
      .not("subject", "is", null)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const latestSubjectByConversation = new Map<string, string>();
    for (const m of recentMessages ?? []) {
      if (!latestSubjectByConversation.has(m.conversation_id) && m.subject) {
        latestSubjectByConversation.set(m.conversation_id, m.subject);
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
    const { data, error } = await this.db
      .from("messages")
      .insert({
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        channel: input.channel,
        direction: input.direction,
        sender_type: input.senderType,
        sender_id: input.senderId ?? null,
        body: input.body,
        subject: input.subject ?? null,
        audio_url: input.audioUrl ?? null,
        transcript: input.transcript ?? null,
        ai_summary: input.aiSummary ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        delivery_status: input.deliveryStatus ?? null,
        // Omit the key entirely (not `?? null`) when unset, so the column's
        // NOT NULL DEFAULT 'internal' applies - explicit null would violate it.
        ...(input.visibility !== undefined && { visibility: input.visibility }),
        scheduled_send_at: input.scheduledSendAt ?? null,
        ai_review_status: input.aiReviewStatus ?? null,
        topic_check_status: input.topicCheckStatus ?? null,
        transcription_status: input.transcriptionStatus ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** Looks up a prior send by reside's idempotency key. Scoped by tenant to
   * match the partial unique index, so two tenants can never collide. */
  async getMessageByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from("messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async getMessageByProviderMessageId(providerMessageId: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from("messages")
      .select("*")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();

    if (error) throw error;
    return data;
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
      const { data: current, error: fetchError } = await this.db
        .from("messages")
        .select("delivery_attempts")
        .eq("id", messageId)
        .single();
      if (fetchError) throw fetchError;

      const { data, error } = await this.db
        .from("messages")
        .update({
          delivery_status: patch.deliveryStatus,
          provider_message_id: patch.providerMessageId,
          delivery_error: patch.deliveryError ?? null,
          sent_at: patch.sentAt,
          delivered_at: patch.deliveredAt,
          delivery_attempts: current.delivery_attempts + 1,
        })
        .eq("id", messageId)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await this.db
      .from("messages")
      .update({
        delivery_status: patch.deliveryStatus,
        provider_message_id: patch.providerMessageId,
        delivery_error: patch.deliveryError ?? null,
        sent_at: patch.sentAt,
        delivered_at: patch.deliveredAt,
      })
      .eq("id", messageId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  // ---- Scheduled external-send dispatch (Phase 3) ----

  /** Best-effort snapshot of due scheduled sends - not itself a claim, see
   * claimScheduledMessage for the atomic per-row step that actually is.
   * Phase 6: also requires ai_review_status = 'approved' - a flagged or
   * still-pending-review message is never due, mirroring how this query
   * already redundantly checks delivery_status alongside claimScheduledMessage. */
  async listDueScheduledMessageIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("id")
      .eq("visibility", "external")
      .eq("delivery_status", "queued")
      .eq("ai_review_status", "approved")
      .not("scheduled_send_at", "is", null)
      .lte("scheduled_send_at", new Date().toISOString())
      .order("scheduled_send_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
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
    const { data, error } = await this.db
      .from("messages")
      .update({ delivery_status: "sending" })
      .eq("id", messageId)
      .eq("delivery_status", "queued")
      .eq("ai_review_status", "approved")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // ---- Tone review (Phase 6) ----

  /** Snapshot of external messages awaiting tone review - no delivery-status
   * or scheduled-time filter, review should start immediately on queue, not
   * wait for the send delay to elapse. */
  async listPendingToneReviewMessageIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("id")
      .eq("visibility", "external")
      .eq("ai_review_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
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
    const { data, error } = await this.db
      .from("messages")
      .update({ ai_review_status: result.status, ai_review_reasoning: result.reasoning })
      .eq("id", messageId)
      .eq("ai_review_status", "pending")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** Admin override for a flagged (or still-pending) message - unblocks the
   * scheduled-message-worker's gate immediately rather than waiting on
   * review. Conditional on the row not already being approved, matching the
   * same idempotent-update idiom used throughout this file. */
  async approveFlaggedMessage(messageId: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from("messages")
      .update({ ai_review_status: "approved" })
      .eq("id", messageId)
      .in("ai_review_status", ["flagged", "pending"])
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** Best-effort cancel of a still-pending scheduled send - the same
   * conditional-update race-safety as claimScheduledMessage applies: if the
   * worker already claimed it (delivery_status moved to 'sending' or
   * beyond), this correctly no-ops and returns null. */
  async cancelScheduledMessage(messageId: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from("messages")
      .update({ delivery_status: "canceled" })
      .eq("id", messageId)
      .eq("delivery_status", "queued")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Creates a bulk-send batch (reside "Notices") plus one pending recipient
   * row per identity. Nothing is dispatched here - the realtime-bridge poll
   * worker (see apps/realtime-bridge/src/workers/outbound-batch-worker.ts)
   * drains pending rows asynchronously through the same per-recipient
   * machinery the single-send endpoint uses.
   */
  async createOutboundBatch(input: {
    tenantId: string;
    channel: "sms" | "email";
    subject?: string;
    body: string;
    recipients: IdentityContact[];
  }): Promise<OutboundBatch> {
    // One transaction: a batch row claiming N recipients, with no recipient
    // rows behind it, would leave the worker reporting a batch that can never
    // complete. supabase-js could not express this - the two inserts were
    // separate round trips with a window between them.
    return this.orm.transaction(async (tx) => {
      const [batch] = await tx
        .insert(outboundBatches)
        .values({
          tenantId: input.tenantId,
          channel: input.channel,
          subject: input.subject ?? null,
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
  async incrementOutboundBatchCompleted(batchId: string): Promise<void> {
    const [batch] = await this.orm
      .select({
        completedRecipients: outboundBatches.completedRecipients,
        totalRecipients: outboundBatches.totalRecipients,
      })
      .from(outboundBatches)
      .where(eq(outboundBatches.id, batchId))
      .limit(1);
    if (!batch) throw new Error(`Unknown outbound batch: ${batchId}`);

    const completed = batch.completedRecipients + 1;
    const isDone = completed >= batch.totalRecipients;

    await this.orm
      .update(outboundBatches)
      .set({
        completedRecipients: completed,
        status: isDone ? "completed" : "processing",
        completedAt: isDone ? new Date() : null,
      })
      .where(eq(outboundBatches.id, batchId));
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
  async getOutboundBatchDetail(batchId: string, tenantId: string): Promise<{
    batch: OutboundBatch;
    recipients: Array<
      OutboundBatchRecipient & {
        deliveryStatus: MessageDeliveryStatus | null;
        deliveryError: string | null;
        openedAt: string | null;
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
          deliveryStatus: message?.delivery_status ?? null,
          deliveryError: message?.delivery_error ?? null,
          openedAt: message?.opened_at ?? null,
        };
      }),
    };
  }

  /** Idempotent first-open recorder for the tracking pixel - only sets
   * opened_at if unset, so the timestamp reflects the first open. */
  async markMessageOpened(messageId: string): Promise<void> {
    const { error } = await this.db
      .from("messages")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", messageId)
      .is("opened_at", null);

    if (error) throw error;
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
    const { data: identity, error: fetchError } = await this.db
      .from("identities")
      .select("email_consecutive_failures, phone_consecutive_failures, email_flagged_at, phone_flagged_at")
      .eq("id", identityId)
      .single();
    if (fetchError) throw fetchError;

    if (outcome === "success") {
      const wasFlagged = Boolean(channel === "email" ? identity.email_flagged_at : identity.phone_flagged_at);
      const update =
        channel === "email"
          ? { email_consecutive_failures: 0, email_flagged_at: null }
          : { phone_consecutive_failures: 0, phone_flagged_at: null };
      const { error } = await this.db.from("identities").update(update).eq("id", identityId);
      if (error) throw error;
      return { crossedThreshold: false, clearedFlag: wasFlagged };
    }

    const currentCount =
      channel === "email" ? identity.email_consecutive_failures : identity.phone_consecutive_failures;
    const alreadyFlagged = Boolean(channel === "email" ? identity.email_flagged_at : identity.phone_flagged_at);
    const newCount = currentCount + 1;
    const crossedThreshold = newCount >= threshold && !alreadyFlagged;

    const update =
      channel === "email"
        ? {
            email_consecutive_failures: newCount,
            ...(crossedThreshold ? { email_flagged_at: new Date().toISOString() } : {}),
          }
        : {
            phone_consecutive_failures: newCount,
            ...(crossedThreshold ? { phone_flagged_at: new Date().toISOString() } : {}),
          };

    const { error } = await this.db.from("identities").update(update).eq("id", identityId);
    if (error) throw error;

    return { crossedThreshold, clearedFlag: false };
  }

  async getConversationsForTenant(
    tenantId: string,
    filters: ConversationFilters = { limit: 50 },
  ): Promise<ConversationWithIdentity[]> {
    let query = this.db
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false })
      .limit(filters.limit);

    // A merged-away conversation is a dead pointer, not a real inbox item -
    // exclude it from the unfiltered default so it never clutters the list/
    // kanban views. An explicit status filter (nothing needs 'merged' today)
    // still overrides this.
    if (filters.status) {
      query = query.eq("status", filters.status);
    } else {
      query = query.neq("status", "merged");
    }
    if (filters.assignedTeamId) query = query.eq("assigned_team_id", filters.assignedTeamId);

    const { data: conversations, error } = await query;
    if (error) throw error;
    if (!conversations?.length) return [];

    const identityIds = [...new Set(conversations.map((c) => c.identity_id))];
    const { data: identities, error: idError } = await this.db
      .from("identities")
      .select("*")
      .in("id", identityIds);

    if (idError) throw idError;
    const identityMap = new Map((identities ?? []).map((i) => [i.id, i]));
    const extrasMap = await this.getConversationExtrasMap(conversations.map((c) => c.id));

    return conversations.map((c) => ({
      ...c,
      identity: identityMap.get(c.identity_id)!,
      ...(extrasMap.get(c.id) ?? { participants: [], tags: [], assignees: [] }),
    }));
  }

  /** Public wrapper over the identity_merge_chain_ids RPC - given any id in
   * an identity's merge history, returns the canonical id plus every id that
   * transitively merged into it. Used both by listConversationsForIdentity
   * below and by the Phase 4 member-conversation-guard's ownership check. */
  async getIdentityMergeChainIds(identityId: string): Promise<string[]> {
    const { data, error } = await this.db.rpc("identity_merge_chain_ids", {
      p_identity_id: identityId,
    });
    if (error) throw error;
    return data ?? [];
  }

  /** Phase 7: given any conversation id (including one that's since been
   * merged away), returns its canonical id - public wrapper over
   * resolve_conversation_id, mirroring resolveIdentityId's role for
   * identities. */
  async resolveConversationId(conversationId: string): Promise<string> {
    const { data, error } = await this.db.rpc("resolve_conversation_id", {
      p_conversation_id: conversationId,
    });
    if (error) throw error;
    return data as string;
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
    tenantId: string,
    identityId: string,
  ): Promise<ConversationWithIdentity[]> {
    const ids = await this.getIdentityMergeChainIds(identityId);
    if (ids.length === 0) return [];

    const { data: conversations, error } = await this.db
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("identity_id", ids)
      .order("last_message_at", { ascending: false });

    if (error) throw error;
    if (!conversations?.length) return [];

    const identityIds = [...new Set(conversations.map((c) => c.identity_id))];
    const { data: identities, error: idError } = await this.db
      .from("identities")
      .select("*")
      .in("id", identityIds);

    if (idError) throw idError;
    const identityMap = new Map((identities ?? []).map((i) => [i.id, i]));
    const extrasMap = await this.getConversationExtrasMap(conversations.map((c) => c.id));

    return conversations.map((c) => ({
      ...c,
      identity: identityMap.get(c.identity_id)!,
      ...(extrasMap.get(c.id) ?? { participants: [], tags: [], assignees: [] }),
    }));
  }

  /** Phase 7: resolves a merged-away id to its canonical conversation first
   * (so every caller - comm-canoe's own dashboard, reside's admin thread
   * view, and transitively the Phase 4 member thread view - transparently
   * lands on the live thread), then reads messages across the *entire*
   * merge chain rather than just this one row, since a merge never rewrites
   * messages.conversation_id. Callers that need to detect the redirect
   * case (e.g. to issue an HTTP redirect to the canonical URL) compare the
   * returned conversation's `id` against the id they requested. */
  async getConversationThread(conversationId: string): Promise<ConversationThread | null> {
    const canonicalId = await this.resolveConversationId(conversationId);

    const { data: conversation, error: convError } = await this.db
      .from("conversations")
      .select("*")
      .eq("id", canonicalId)
      .maybeSingle();

    if (convError) throw convError;
    if (!conversation) return null;

    const { data: identity, error: identityError } = await this.db
      .from("identities")
      .select("*")
      .eq("id", conversation.identity_id)
      .single();

    if (identityError) throw identityError;

    const chainIds = await this.getConversationMergeChainIds(canonicalId);

    const { data: messages, error: msgError } = await this.db
      .from("messages")
      .select("*")
      .in("conversation_id", chainIds)
      .order("created_at", { ascending: true });

    if (msgError) throw msgError;

    const extrasMap = await this.getConversationExtrasMap([canonicalId]);

    return {
      ...conversation,
      identity,
      messages: messages ?? [],
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

    const [participantsRes, tagsRes, assigneesRes] = await Promise.all([
      this.db.from("conversation_participants").select("*").in("conversation_id", conversationIds),
      this.db.from("conversation_tags").select("conversation_id, tags(*)").in("conversation_id", conversationIds),
      this.db.from("conversation_assignees").select("*").in("conversation_id", conversationIds),
    ]);

    if (participantsRes.error) throw participantsRes.error;
    if (tagsRes.error) throw tagsRes.error;
    if (assigneesRes.error) throw assigneesRes.error;

    for (const p of (participantsRes.data ?? []) as ConversationParticipant[]) {
      map.get(p.conversation_id)?.participants.push(p);
    }

    for (const row of (tagsRes.data ?? []) as unknown as Array<{ conversation_id: string; tags: Tag | null }>) {
      if (row.tags) map.get(row.conversation_id)?.tags.push(row.tags);
    }

    for (const a of (assigneesRes.data ?? []) as ConversationAssignee[]) {
      map.get(a.conversation_id)?.assignees.push(a);
    }

    return map;
  }

  async getTeamsForTenant(tenantId: string): Promise<Team[]> {
    const { data, error } = await this.db
      .from("teams")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) throw error;
    return data ?? [];
  }

  async assignConversationTeam(conversationId: string, teamId: string | null) {
    const { data, error } = await this.db
      .from("conversations")
      .update({ assigned_team_id: teamId })
      .eq("id", conversationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async updateConversationSummary(conversationId: string, summary: string) {
    const { data, error } = await this.db
      .from("conversations")
      .update({ summary })
      .eq("id", conversationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  // ---- Tags (Phase 2 / 2A) ----

  async createTag(tenantId: string, name: string, color?: string): Promise<Tag> {
    const { data, error } = await this.db
      .from("tags")
      .insert({ tenant_id: tenantId, name, color: color ?? null })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async listTenantTags(tenantId: string): Promise<Tag[]> {
    const { data, error } = await this.db.from("tags").select("*").eq("tenant_id", tenantId).order("name");
    if (error) throw error;
    return data ?? [];
  }

  async addConversationTag(conversationId: string, tagId: string): Promise<void> {
    const { error } = await this.db
      .from("conversation_tags")
      .upsert({ conversation_id: conversationId, tag_id: tagId }, { onConflict: "conversation_id,tag_id" });
    if (error) throw error;
  }

  async removeConversationTag(conversationId: string, tagId: string): Promise<void> {
    const { error } = await this.db
      .from("conversation_tags")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("tag_id", tagId);
    if (error) throw error;
  }

  async listConversationTags(conversationId: string): Promise<Tag[]> {
    const { data, error } = await this.db
      .from("conversation_tags")
      .select("tags(*)")
      .eq("conversation_id", conversationId);
    if (error) throw error;
    return ((data ?? []) as unknown as Array<{ tags: Tag | null }>).flatMap((r) => (r.tags ? [r.tags] : []));
  }

  // ---- Multi-assignee (Phase 2 / 2B) — additive alongside assignConversationUser/Team above ----

  async addConversationAssignee(
    conversationId: string,
    userId: string,
    assignedBy?: string,
  ): Promise<ConversationAssignee> {
    const { data, error } = await this.db
      .from("conversation_assignees")
      .upsert(
        { conversation_id: conversationId, user_id: userId, assigned_by: assignedBy ?? null },
        { onConflict: "conversation_id,user_id" },
      )
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async removeConversationAssignee(conversationId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from("conversation_assignees")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async listConversationAssignees(conversationId: string): Promise<ConversationAssignee[]> {
    const { data, error } = await this.db
      .from("conversation_assignees")
      .select("*")
      .eq("conversation_id", conversationId);
    if (error) throw error;
    return data ?? [];
  }

  // ---- Personal tags (Reside dashboard viewer relevance) — a lighter-weight
  // "relevant to me" marker than assignees, same shape/dedup pattern. ----

  async addConversationPersonalTag(conversationId: string, userId: string): Promise<ConversationPersonalTag> {
    const { data, error } = await this.db
      .from("conversation_personal_tags")
      .upsert({ conversation_id: conversationId, user_id: userId }, { onConflict: "conversation_id,user_id" })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async removeConversationPersonalTag(conversationId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from("conversation_personal_tags")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async listConversationPersonalTags(conversationId: string): Promise<ConversationPersonalTag[]> {
    const { data, error } = await this.db
      .from("conversation_personal_tags")
      .select("*")
      .eq("conversation_id", conversationId);
    if (error) throw error;
    return data ?? [];
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
    conversations: Array<Pick<Conversation, "id" | "last_message_at">>,
    viewerUserId: string,
  ): Promise<Map<string, ConversationViewerState>> {
    const map = new Map<string, ConversationViewerState>();
    if (conversations.length === 0) return map;

    const conversationIds = conversations.map((c) => c.id);
    const [assigneeRes, personalTagRes, readStateRes] = await Promise.all([
      this.db
        .from("conversation_assignees")
        .select("conversation_id")
        .eq("user_id", viewerUserId)
        .in("conversation_id", conversationIds),
      this.db
        .from("conversation_personal_tags")
        .select("conversation_id")
        .eq("user_id", viewerUserId)
        .in("conversation_id", conversationIds),
      this.db
        .from("conversation_read_states")
        .select("conversation_id, last_read_at")
        .eq("user_id", viewerUserId)
        .in("conversation_id", conversationIds),
    ]);
    if (assigneeRes.error) throw assigneeRes.error;
    if (personalTagRes.error) throw personalTagRes.error;
    if (readStateRes.error) throw readStateRes.error;

    const relevantIds = new Set<string>([
      ...(assigneeRes.data ?? []).map((r) => r.conversation_id as string),
      ...(personalTagRes.data ?? []).map((r) => r.conversation_id as string),
    ]);
    const lastReadAtByConversation = new Map(
      (readStateRes.data ?? []).map((r) => [r.conversation_id as string, r.last_read_at as string]),
    );

    for (const c of conversations) {
      const isRelevant = relevantIds.has(c.id);
      const lastReadAt = lastReadAtByConversation.get(c.id) ?? null;
      const hasUnread = isRelevant && (!lastReadAt || new Date(lastReadAt) < new Date(c.last_message_at));
      map.set(c.id, {
        viewer_is_relevant: isRelevant,
        viewer_has_unread: hasUnread,
        viewer_last_read_at: lastReadAt,
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
    tenantId: string,
    viewerUserId: string,
  ): Promise<{ unread_relevant_count: number; open_relevant_count: number }> {
    const { data: conversations, error } = await this.db
      .from("conversations")
      .select("id, status, last_message_at")
      .eq("tenant_id", tenantId)
      .neq("status", "merged");
    if (error) throw error;
    if (!conversations?.length) return { unread_relevant_count: 0, open_relevant_count: 0 };

    const states = await this.getViewerConversationStates(conversations, viewerUserId);

    let unread = 0;
    let open = 0;
    for (const c of conversations) {
      const state = states.get(c.id);
      if (!state?.viewer_is_relevant) continue;
      if (c.status !== "resolved") open += 1;
      if (state.viewer_has_unread) unread += 1;
    }
    return { unread_relevant_count: unread, open_relevant_count: open };
  }

  // ---- Multi-participant conversations (Phase 2 / 2D) — purely additive, see
  // conversation_participants migration's comment: conversations.identity_id
  // stays the unchanged "primary" identity for all existing threading logic. ----

  async addConversationParticipant(
    conversationId: string,
    participant: { identityId: string } | { userId: string },
  ): Promise<ConversationParticipant> {
    const isIdentity = "identityId" in participant;
    const { data, error } = await this.db
      .from("conversation_participants")
      .insert({
        conversation_id: conversationId,
        identity_id: isIdentity ? participant.identityId : null,
        user_id: isIdentity ? null : participant.userId,
        role: isIdentity ? "external" : "internal",
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async removeConversationParticipant(conversationId: string, participantId: string): Promise<void> {
    const { error } = await this.db
      .from("conversation_participants")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("id", participantId);
    if (error) throw error;
  }

  async listConversationParticipants(conversationId: string): Promise<ConversationParticipant[]> {
    const { data, error } = await this.db
      .from("conversation_participants")
      .select("*")
      .eq("conversation_id", conversationId);
    if (error) throw error;
    return data ?? [];
  }

  // ---- Conversation merging (Phase 7) — admin-triggered, closes the real
  // gap where mergeIdentities never re-points conversations.identity_id,
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
    const [
      tagsRes,
      assigneesRes,
      sourceParticipantsRes,
      targetParticipantsRes,
      personalTagsRes,
      sourceReadStatesRes,
      targetReadStatesRes,
    ] = await Promise.all([
      this.db.from("conversation_tags").select("tag_id").eq("conversation_id", sourceId),
      this.db.from("conversation_assignees").select("user_id, assigned_by").eq("conversation_id", sourceId),
      this.db.from("conversation_participants").select("identity_id, user_id, role").eq("conversation_id", sourceId),
      this.db.from("conversation_participants").select("identity_id, user_id").eq("conversation_id", targetId),
      this.db.from("conversation_personal_tags").select("user_id").eq("conversation_id", sourceId),
      this.db
        .from("conversation_read_states")
        .select("user_id, last_read_at, last_read_message_id")
        .eq("conversation_id", sourceId),
      this.db
        .from("conversation_read_states")
        .select("user_id, last_read_at, last_read_message_id")
        .eq("conversation_id", targetId),
    ]);
    if (tagsRes.error) throw tagsRes.error;
    if (assigneesRes.error) throw assigneesRes.error;
    if (sourceParticipantsRes.error) throw sourceParticipantsRes.error;
    if (targetParticipantsRes.error) throw targetParticipantsRes.error;
    if (personalTagsRes.error) throw personalTagsRes.error;
    if (sourceReadStatesRes.error) throw sourceReadStatesRes.error;
    if (targetReadStatesRes.error) throw targetReadStatesRes.error;

    const tagRows = (tagsRes.data ?? []).map((t) => ({ conversation_id: targetId, tag_id: t.tag_id as string }));
    const assigneeRows = (assigneesRes.data ?? []).map((a) => ({
      conversation_id: targetId,
      user_id: a.user_id as string,
      assigned_by: a.assigned_by as string | null,
    }));
    const personalTagRows = (personalTagsRes.data ?? []).map((t) => ({
      conversation_id: targetId,
      user_id: t.user_id as string,
    }));

    const existingParticipantKeys = new Set(
      (targetParticipantsRes.data ?? []).map((p) => `${p.identity_id ?? ""}:${p.user_id ?? ""}`),
    );
    const participantRows = (sourceParticipantsRes.data ?? [])
      .filter((p) => !existingParticipantKeys.has(`${p.identity_id ?? ""}:${p.user_id ?? ""}`))
      .map((p) => ({
        conversation_id: targetId,
        identity_id: p.identity_id as string | null,
        user_id: p.user_id as string | null,
        role: p.role as "external" | "internal",
      }));

    const readStateByUser = new Map<string, { last_read_at: string; last_read_message_id: string | null }>();
    for (const row of [...(targetReadStatesRes.data ?? []), ...(sourceReadStatesRes.data ?? [])]) {
      const userId = row.user_id as string;
      const existing = readStateByUser.get(userId);
      if (!existing || new Date(row.last_read_at as string) > new Date(existing.last_read_at)) {
        readStateByUser.set(userId, {
          last_read_at: row.last_read_at as string,
          last_read_message_id: row.last_read_message_id as string | null,
        });
      }
    }
    const readStateRows = [...readStateByUser.entries()].map(([userId, state]) => ({
      conversation_id: targetId,
      user_id: userId,
      ...state,
    }));

    const [tagWrite, assigneeWrite, participantWrite, personalTagWrite, readStateWrite] = await Promise.all([
      tagRows.length
        ? this.db.from("conversation_tags").upsert(tagRows, { onConflict: "conversation_id,tag_id" })
        : { error: null },
      assigneeRows.length
        ? this.db.from("conversation_assignees").upsert(assigneeRows, { onConflict: "conversation_id,user_id" })
        : { error: null },
      participantRows.length
        ? this.db.from("conversation_participants").insert(participantRows)
        : { error: null },
      personalTagRows.length
        ? this.db
            .from("conversation_personal_tags")
            .upsert(personalTagRows, { onConflict: "conversation_id,user_id" })
        : { error: null },
      readStateRows.length
        ? this.db.from("conversation_read_states").upsert(readStateRows, { onConflict: "conversation_id,user_id" })
        : { error: null },
    ]);
    if (tagWrite.error) throw tagWrite.error;
    if (assigneeWrite.error) throw assigneeWrite.error;
    if (participantWrite.error) throw participantWrite.error;
    if (personalTagWrite.error) throw personalTagWrite.error;
    if (readStateWrite.error) throw readStateWrite.error;

    const [delTags, delAssignees, delParticipants, delPersonalTags, delReadStates] = await Promise.all([
      this.db.from("conversation_tags").delete().eq("conversation_id", sourceId),
      this.db.from("conversation_assignees").delete().eq("conversation_id", sourceId),
      this.db.from("conversation_participants").delete().eq("conversation_id", sourceId),
      this.db.from("conversation_personal_tags").delete().eq("conversation_id", sourceId),
      this.db.from("conversation_read_states").delete().eq("conversation_id", sourceId),
    ]);
    if (delTags.error) throw delTags.error;
    if (delAssignees.error) throw delAssignees.error;
    if (delParticipants.error) throw delParticipants.error;
    if (delPersonalTags.error) throw delPersonalTags.error;
    if (delReadStates.error) throw delReadStates.error;
  }

  /** Signals comm-canoe's own dashboard (apps/web/src/components/inbox/
   * chat-realtime.tsx's useConversationRealtime, subscribed to
   * `chat:conversation:{id}` for whichever conversation is currently
   * selected) that a conversation changed structurally, so it refetches
   * instead of waiting for a poll/reload. Deliberately a distinct "updated"
   * event, not a reuse of the existing "message" broadcast/
   * ChatBroadcastMessage payload - that type is web_chat-shaped
   * (channel: "web_chat" literal) and is only ever fired today from the
   * live chat-widget's own session code (chat-session.ts); a merge/split
   * can affect a conversation of any channel, and the frontend listener
   * ignores the payload anyway (it only triggers a refetch), so a minimal,
   * honestly-named event is simpler than stretching a chat-specific shape
   * to fit. Uses `this.db` directly rather than importing realtime-bridge's
   * broadcast.ts, since that file lives in a different app and the two
   * don't cross-import (same boundary Phase 5's notify helpers respected). */
  private async broadcastConversationUpdated(conversationId: string): Promise<void> {
    const channel = this.db.channel(`chat:conversation:${conversationId}`);
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
    await channel.send({ type: "broadcast", event: "updated", payload: {} });
    await this.db.removeChannel(channel);
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
  async mergeConversations(tenantId: string, sourceId: string, targetId: string): Promise<string> {
    const [canonicalSourceId, canonicalTargetId] = await Promise.all([
      this.resolveConversationId(sourceId),
      this.resolveConversationId(targetId),
    ]);

    if (canonicalSourceId === canonicalTargetId) {
      throw new Error("These conversations are already merged.");
    }

    const { data: conversations, error } = await this.db
      .from("conversations")
      .select("*")
      .in("id", [canonicalSourceId, canonicalTargetId]);
    if (error) throw error;

    const source = conversations?.find((c) => c.id === canonicalSourceId);
    const target = conversations?.find((c) => c.id === canonicalTargetId);
    if (!source || !target) throw new Error("Conversation not found.");
    if (source.tenant_id !== tenantId || target.tenant_id !== tenantId) {
      throw new Error("Conversations do not belong to this tenant.");
    }

    const targetIdentityChain = await this.getIdentityMergeChainIds(target.identity_id);
    if (!targetIdentityChain.includes(source.identity_id)) {
      throw new Error("These conversations belong to different residents - merge identities first.");
    }

    await this.moveConversationExtras(canonicalSourceId, canonicalTargetId);

    const lastMessageAt =
      new Date(source.last_message_at) > new Date(target.last_message_at)
        ? source.last_message_at
        : target.last_message_at;

    const [targetUpdate, sourceUpdate] = await Promise.all([
      this.db.from("conversations").update({ last_message_at: lastMessageAt }).eq("id", canonicalTargetId),
      this.db
        .from("conversations")
        .update({ status: "merged", merged_into_id: canonicalTargetId })
        .eq("id", canonicalSourceId),
    ]);
    if (targetUpdate.error) throw targetUpdate.error;
    if (sourceUpdate.error) throw sourceUpdate.error;

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
    tenantId: string,
    sourceConversationId: string,
    splitMessageId: string,
    actorUserId: string | null,
    options?: { triggerType?: "admin" | "ai"; reasoning?: string | null },
  ): Promise<string> {
    const canonicalSourceId = await this.resolveConversationId(sourceConversationId);

    const { data: source, error: sourceError } = await this.db
      .from("conversations")
      .select("*")
      .eq("id", canonicalSourceId)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source || source.tenant_id !== tenantId) {
      throw new Error("Conversation not found.");
    }

    // Chain-aware, not a literal equality check: a message that arrived via
    // an earlier merge still carries its pre-merge conversation_id (merge
    // never rewrites messages.conversation_id, unlike split) - getConversationThread
    // already reads across the whole chain, so ownership here has to match.
    const chainIds = await this.getConversationMergeChainIds(canonicalSourceId);

    const { data: splitMessage, error: messageError } = await this.db
      .from("messages")
      .select("id, conversation_id, created_at")
      .eq("id", splitMessageId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!splitMessage || !chainIds.includes(splitMessage.conversation_id)) {
      throw new Error("That message does not belong to this conversation.");
    }

    const { data: target, error: createError } = await this.db
      .from("conversations")
      .insert({ tenant_id: tenantId, identity_id: source.identity_id, status: "open" })
      .select("*")
      .single();
    if (createError) throw createError;

    const recheckId = await this.resolveConversationId(sourceConversationId);
    if (recheckId !== canonicalSourceId) {
      await this.db.from("conversations").delete().eq("id", target.id);
      throw new Error("This conversation was merged into another one - refresh and try again.");
    }

    const { data: movedMessages, error: moveError } = await this.db
      .from("messages")
      .update({ conversation_id: target.id })
      .in("conversation_id", chainIds)
      .gte("created_at", splitMessage.created_at)
      .select("id, created_at");
    if (moveError) throw moveError;

    const movedIds = (movedMessages ?? []).map((m) => m.id);
    const targetLastMessageAt = (movedMessages ?? []).reduce(
      (latest, m) => (m.created_at > latest ? m.created_at : latest),
      splitMessage.created_at as string,
    );

    if (movedIds.length) {
      // Table is "live_transfers" (renamed from call_transfers in
      // 20250621140000_web_chat_and_live_transfer.sql) - has two
      // independent pointers to the same event (conversation_id NOT NULL,
      // message_id nullable); left unfixed they'd actively disagree, not
      // just go stale, once the referenced message moves.
      const { error: liveTransferError } = await this.db
        .from("live_transfers")
        .update({ conversation_id: target.id })
        .in("message_id", movedIds);
      if (liveTransferError) throw liveTransferError;
    }

    const { data: latestRemaining, error: remainingError } = await this.db
      .from("messages")
      .select("created_at")
      .in("conversation_id", chainIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (remainingError) throw remainingError;

    const [sourceTimestampUpdate, targetTimestampUpdate] = await Promise.all([
      this.db
        .from("conversations")
        .update({ last_message_at: latestRemaining?.created_at ?? source.created_at })
        .eq("id", canonicalSourceId),
      this.db.from("conversations").update({ last_message_at: targetLastMessageAt }).eq("id", target.id),
    ]);
    if (sourceTimestampUpdate.error) throw sourceTimestampUpdate.error;
    if (targetTimestampUpdate.error) throw targetTimestampUpdate.error;

    await Promise.all([
      this.recomputeConversationSla(tenantId, canonicalSourceId),
      this.recomputeConversationSla(tenantId, target.id),
    ]);

    const { error: logError } = await this.db.from("conversation_splits").insert({
      tenant_id: tenantId,
      source_conversation_id: canonicalSourceId,
      target_conversation_id: target.id,
      split_message_id: splitMessageId,
      trigger_type: options?.triggerType ?? "admin",
      triggered_by_user_id: actorUserId,
      reasoning: options?.reasoning ?? null,
    });
    if (logError) throw logError;

    await Promise.all([
      this.broadcastConversationUpdated(canonicalSourceId),
      this.broadcastConversationUpdated(target.id),
    ]);

    return target.id;
  }

  // ---- AI-automated conversation routing (Phase 9) ----

  async listPendingTopicCheckMessageIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("id")
      .eq("topic_check_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
  }

  /** Atomic claim, mirroring claimScheduledMessage - required here (unlike
   * applyToneReviewResult's plain conditional update) because the dangerous
   * side effect (splitConversation, non-idempotent) happens before any
   * "done" write, so a check-only-on-final-write wouldn't stop two
   * overlapping worker ticks from both acting on the same message. Found by
   * a design-review pass, not by testing. */
  async claimTopicCheckMessage(messageId: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from("messages")
      .update({ topic_check_status: "processing" })
      .eq("id", messageId)
      .eq("topic_check_status", "pending")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** Terminal write for a claimed message, regardless of outcome (split or
   * not) - topic_check_status lives on the message row, which travels with
   * it even after splitConversation moves it to a different conversation,
   * so this always needs its own call, not something splitConversation
   * does implicitly. */
  async markTopicCheckReviewed(messageId: string): Promise<void> {
    const { error } = await this.db.from("messages").update({ topic_check_status: "reviewed" }).eq("id", messageId);
    if (error) throw error;
  }

  /** Cheap circuit breaker using data already being written - checked
   * before an AI-triggered split, not a defensive guard elsewhere. A wrong
   * *individual* auto-split is cheap to fix via merge, but nothing else
   * would tell an admin "the classifier is over-triggering on this
   * tenant," so this caps the blast radius of a systematic misfire rather
   * than relying on per-instance reversibility alone. */
  async countRecentAiSplits(tenantId: string, sinceMinutes: number): Promise<number> {
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const { count, error } = await this.db
      .from("conversation_splits")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("trigger_type", "ai")
      .gte("created_at", since);

    if (error) throw error;
    return count ?? 0;
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
    const { data, error } = await this.db
      .from("conversation_splits")
      .select("source_conversation_id, trigger_type, reasoning, created_at")
      .eq("target_conversation_id", conversationId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return {
      sourceConversationId: data.source_conversation_id,
      triggerType: data.trigger_type as "admin" | "ai",
      reasoning: data.reasoning,
      createdAt: data.created_at,
    };
  }

  /** Surfaces "this resident's other conversations" for the merge UI -
   * resolves to canonical, walks the resident's full identity merge-chain
   * (catching the exact gap found in research: two identities that later
   * merged, each with their own pre-existing open conversation), and
   * excludes anything already merged into this one. */
  async listRelatedConversations(tenantId: string, conversationId: string): Promise<ConversationWithIdentity[]> {
    const canonicalId = await this.resolveConversationId(conversationId);

    const { data: conversation, error: convError } = await this.db
      .from("conversations")
      .select("identity_id")
      .eq("id", canonicalId)
      .maybeSingle();
    if (convError) throw convError;
    if (!conversation) return [];

    const [identityIds, ownChainIds] = await Promise.all([
      this.getIdentityMergeChainIds(conversation.identity_id),
      this.getConversationMergeChainIds(canonicalId),
    ]);

    const { data: candidates, error } = await this.db
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("identity_id", identityIds)
      .neq("status", "merged")
      .order("last_message_at", { ascending: false });
    if (error) throw error;

    const ownChainSet = new Set(ownChainIds);
    const related = (candidates ?? []).filter((c) => !ownChainSet.has(c.id));
    if (!related.length) return [];

    const relatedIdentityIds = [...new Set(related.map((c) => c.identity_id))];
    const { data: identities, error: idError } = await this.db
      .from("identities")
      .select("*")
      .in("id", relatedIdentityIds);
    if (idError) throw idError;
    const identityMap = new Map((identities ?? []).map((i) => [i.id, i]));
    const extrasMap = await this.getConversationExtrasMap(related.map((c) => c.id));

    return related.map((c) => ({
      ...c,
      identity: identityMap.get(c.identity_id)!,
      ...(extrasMap.get(c.id) ?? { participants: [], tags: [], assignees: [] }),
    }));
  }

  // ---- Ticketing/SLA (Phase 2 / 2E) — schema + manual setters only; the
  // scan-for-overdue-conversations job is Phase 5's job. ----

  async updateConversationPriority(conversationId: string, priority: ConversationPriority) {
    const { data, error } = await this.db
      .from("conversations")
      .update({ priority })
      .eq("id", conversationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async setConversationResponseDueAt(conversationId: string, dueAt: string | null) {
    const { data, error } = await this.db
      .from("conversations")
      .update({ response_due_at: dueAt })
      .eq("id", conversationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  /** Best-effort snapshot of overdue conversations - not itself a claim, see
   * claimOverdueConversationNotification for the atomic per-row step. Same
   * shape as listDueScheduledMessageIds (Phase 3). */
  async listOverdueConversationIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("conversations")
      .select("id")
      .not("response_due_at", "is", null)
      .lte("response_due_at", new Date().toISOString())
      .is("response_overdue_notified_at", null)
      .order("response_due_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
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
    const { data, error } = await this.db
      .from("conversations")
      .update({ response_overdue_notified_at: new Date().toISOString() })
      .eq("id", conversationId)
      .is("response_overdue_notified_at", null)
      .select("*")
      .maybeSingle();

    if (error) throw error;
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
  async recomputeConversationSla(tenantId: string, conversationId: string): Promise<void> {
    // Chain-aware: a conversation with merge history has messages whose raw
    // conversation_id still points at an earlier, merged-away conversation
    // (merge never rewrites messages.conversation_id) - the true message
    // set has to be read the same way getConversationThread reads it.
    const chainIds = await this.getConversationMergeChainIds(conversationId);

    const { data: latestExternal, error: latestError } = await this.db
      .from("messages")
      .select("direction, created_at")
      .in("conversation_id", chainIds)
      .eq("visibility", "external")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    if (!latestExternal || latestExternal.direction === "outbound") {
      const { error } = await this.db
        .from("conversations")
        .update({ response_due_at: null, response_overdue_notified_at: null })
        .eq("id", conversationId);
      if (error) throw error;
      return;
    }

    // latestExternal is inbound - find the start of the current unanswered
    // streak: the earliest inbound-external message after the most recent
    // outbound-external one, or the earliest inbound-external message
    // overall if there's never been an outbound one.
    const { data: lastOutbound, error: outboundError } = await this.db
      .from("messages")
      .select("created_at")
      .in("conversation_id", chainIds)
      .eq("visibility", "external")
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (outboundError) throw outboundError;

    let streakStartQuery = this.db
      .from("messages")
      .select("created_at")
      .in("conversation_id", chainIds)
      .eq("visibility", "external")
      .eq("direction", "inbound")
      .order("created_at", { ascending: true })
      .limit(1);
    if (lastOutbound) streakStartQuery = streakStartQuery.gt("created_at", lastOutbound.created_at);

    const { data: streakStart, error: streakError } = await streakStartQuery.maybeSingle();
    if (streakError) throw streakError;
    if (!streakStart) return;

    const settings = await this.getTenantSettings(tenantId);
    const windowMinutes = settings?.default_response_window_minutes ?? 60;
    const dueAt = new Date(new Date(streakStart.created_at).getTime() + windowMinutes * 60_000).toISOString();

    const { error } = await this.db
      .from("conversations")
      .update({ response_due_at: dueAt, response_overdue_notified_at: null })
      .eq("id", conversationId);
    if (error) throw error;
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
    const { data, error } = await this.db
      .from("conversations")
      .update({ status })
      .eq("id", conversationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async getResolvedConversationExamples(tenantId: string, limit = 5) {
    const { data: conversations, error } = await this.db
      .from("conversations")
      .select("id, summary")
      .eq("tenant_id", tenantId)
      .eq("status", "resolved")
      .not("summary", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    if (!conversations?.length) return [];

    const ids = conversations.map((c) => c.id);
    const { data: messages, error: msgError } = await this.db
      .from("messages")
      .select("conversation_id, body, direction, sender_type")
      .in("conversation_id", ids);

    if (msgError) throw msgError;

    return conversations.map((c) => {
      const msgs = (messages ?? []).filter((m) => m.conversation_id === c.id);
      const sampleReply =
        msgs.find((m) => m.direction === "outbound" && m.sender_type === "internal_user")
          ?.body ?? "";
      return { summary: c.summary, sampleReply };
    });
  }

  async getTenantSettings(tenantId: string) {
    const { data, error } = await this.db
      .from("tenant_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** First application-layer write path to tenant_settings - previously only
   * reachable via the tenant_settings_update_admin RLS policy with no method
   * calling it. Plain upsert-by-tenant_id, same idiom as every other settings
   * setter in this codebase. */
  async updateTenantSettings(
    tenantId: string,
    patch: Partial<Omit<TenantSettingsRow, "tenant_id" | "updated_at">>,
  ): Promise<TenantSettingsRow> {
    const { data, error } = await this.db
      .from("tenant_settings")
      .upsert({ tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async getUserTenants(userId: string) {
    const { data: memberships, error } = await this.db
      .from("user_tenant_memberships")
      .select("tenant_id, role")
      .eq("user_id", userId);

    if (error) throw error;
    if (!memberships?.length) return [];

    const tenantIds = memberships.map((m) => m.tenant_id);
    const { data: tenants, error: tenantError } = await this.db
      .from("tenants")
      .select("*")
      .in("id", tenantIds);

    if (tenantError) throw tenantError;
    const tenantMap = new Map((tenants ?? []).map((t) => [t.id, t]));

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
  async countTenantDocuments(tenantId: string): Promise<number> {
    const { count, error } = await this.db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (error) throw error;
    return count ?? 0;
  }

  async countTenantChunks(tenantId: string): Promise<number> {
    const { count, error } = await this.db
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (error) throw error;
    return count ?? 0;
  }

  async createDocument(input: {
    tenantId: string;
    filename: string;
    contentText: string;
    extractor: string;
    pageCount?: number | null;
    uploadedBy?: string | null;
  }): Promise<Document> {
    const { data, error } = await this.db
      .from("documents")
      .insert({
        tenant_id: input.tenantId,
        filename: input.filename,
        content_text: input.contentText,
        extractor: input.extractor,
        page_count: input.pageCount ?? null,
        uploaded_by: input.uploadedBy ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async listDocumentsForTenant(tenantId: string): Promise<Document[]> {
    const { data, error } = await this.db
      .from("documents")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async getDocument(tenantId: string, documentId: string): Promise<Document | null> {
    const { data, error } = await this.db
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** document_chunks.document_id has ON DELETE CASCADE (migration
   * 20250701001500) - deleting the document row cleans up its chunks
   * automatically, no app-layer delete-then-delete needed. */
  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const { error } = await this.db.from("documents").delete().eq("id", documentId).eq("tenant_id", tenantId);
    if (error) throw error;
  }

  async listPendingDocumentIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("documents")
      .select("id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
  }

  /** Same atomic-claim shape as claimTopicCheckMessage (Phase 9) - chunking
   * + embedding is the non-idempotent side effect here, so a plain
   * conditional update on the terminal write wouldn't stop two overlapping
   * worker ticks from both ingesting the same document. */
  async claimPendingDocument(documentId: string): Promise<Document | null> {
    const { data, error } = await this.db
      .from("documents")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async insertDocumentChunks(chunks: DocumentChunkInsert[]): Promise<void> {
    if (chunks.length === 0) return;
    const { error } = await this.db.from("document_chunks").insert(chunks);
    if (error) throw error;
  }

  async markDocumentReady(documentId: string): Promise<void> {
    const { error } = await this.db
      .from("documents")
      .update({ status: "ready", failure_reason: null, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) throw error;
  }

  /** Never left stuck at pending/processing - every ingestion failure path
   * (embedding call throws, cap exceeded mid-ingestion, claimed row deleted
   * mid-tick) ends here with a reason, matching every other worker's
   * safety-net convention in this codebase. */
  async markDocumentFailed(documentId: string, reason: string): Promise<void> {
    const { error } = await this.db
      .from("documents")
      .update({ status: "failed", failure_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) throw error;
  }

  /** Exact (not approximate/HNSW) cosine similarity scan via the
   * match_document_chunks RPC, scoped by tenant_id - see the RAG migrations'
   * header comments for why no index backs this at launch. Over-fetches
   * (fetchMultiplier * topK) and applies a diversity cap client-side so
   * near-duplicate adjacent chunks from one document can't crowd out other
   * sources in the final top-K. */
  async findSimilarChunks(
    tenantId: string,
    queryEmbedding: number[],
    options?: { topK?: number; maxPerDocument?: number; fetchMultiplier?: number },
  ): Promise<Array<{ id: string; documentId: string; heading: string | null; content: string }>> {
    const topK = options?.topK ?? 5;
    const maxPerDocument = options?.maxPerDocument ?? 3;
    const fetchMultiplier = options?.fetchMultiplier ?? 4;

    const { data, error } = await this.db.rpc("match_document_chunks", {
      p_tenant_id: tenantId,
      p_query_embedding: queryEmbedding,
      p_match_count: topK * fetchMultiplier,
    });
    if (error) throw error;

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
    const { data, error } = await this.db
      .from("messages")
      .update({ transcription_status: "transcribing" })
      .eq("id", messageId)
      .eq("transcription_status", "pending")
      .select("id")
      .maybeSingle();

    if (error) throw error;
    return Boolean(data);
  }

  async listPendingVoicemailTranscriptionMessageIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("id")
      .eq("transcription_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
  }

  /** Plain conditional update, not an atomic claim like Phase 9/10's workers
   * need - re-running a transcription on the same audio wastes an API call
   * but doesn't corrupt state (unlike splitConversation or document
   * chunking, which are non-idempotent side effects that must happen
   * exactly once), so the simpler check-only-on-write pattern (mirroring
   * applyToneReviewResult) is sufficient here. */
  async updateMessageTranscription(messageId: string, body: string): Promise<void> {
    const { error } = await this.db
      .from("messages")
      .update({ body, transcript: body, transcription_status: "ready" })
      .eq("id", messageId)
      .eq("transcription_status", "pending");
    if (error) throw error;
  }

  /** Never left stuck at pending - mirrors every other worker's safety-net
   * convention (markDocumentFailed, applyToneReviewResult's default-to-
   * flagged, markTopicCheckReviewed). */
  async markMessageTranscriptionFailed(messageId: string, reason: string): Promise<void> {
    const { error } = await this.db
      .from("messages")
      .update({ transcription_status: "failed", transcription_failure_reason: reason })
      .eq("id", messageId)
      .eq("transcription_status", "pending");
    if (error) throw error;
  }

  private async findIdentityByPhone(tenantId: string, phone: string) {
    const { data, error } = await this.db
      .from("identities")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .is("merged_into_id", null)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  private async findIdentityByEmail(tenantId: string, email: string) {
    const { data, error } = await this.db
      .from("identities")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .is("merged_into_id", null)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  private async mergeIdentities(
    tenantId: string,
    keepId: string,
    mergeId: string,
    matchedOn: "phone" | "email",
  ) {
    const canonicalKeep = await this.resolveIdentityId(keepId);
    const canonicalMerge = await this.resolveIdentityId(mergeId);
    if (canonicalKeep === canonicalMerge) return;

    await this.db
      .from("identities")
      .update({ merged_into_id: canonicalKeep })
      .eq("id", canonicalMerge);

    await this.db.from("identity_merge_logs").insert({
      tenant_id: tenantId,
      identity_a_id: canonicalKeep,
      identity_b_id: canonicalMerge,
      matched_on: matchedOn,
      merged_by: "system",
    });
  }

  private async resolveIdentityId(identityId: string): Promise<string> {
    const { data, error } = await this.db.rpc("resolve_identity_id", {
      p_identity_id: identityId,
    });
    if (error) throw error;
    return data as string;
  }

  private async getCanonicalIdentity(identityId: string): Promise<Identity> {
    const canonicalId = await this.resolveIdentityId(identityId);
    const { data, error } = await this.db
      .from("identities")
      .select("*")
      .eq("id", canonicalId)
      .single();

    if (error) throw error;
    return data;
  }
}

export function createDomainService(db?: AppSupabaseClient) {
  return new DomainService(db ?? createServiceClient());
}

export * from "./chat-session";
