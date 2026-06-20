import type { AppendMessageInput, ConversationFilters, IdentityContact } from "@contact/shared";
import type { AppSupabaseClient } from "../client";
import { createServiceClient, normalizeEmail, normalizePhone } from "../client";
import type {
  ConversationThread,
  ConversationWithIdentity,
  Identity,
  Message,
  Team,
  Tenant,
} from "../types";

export class DomainService {
  constructor(private db: AppSupabaseClient) {}

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
      return this.getCanonicalIdentity(existing.id);
    }

    const { data, error } = await this.db
      .from("identities")
      .insert({
        tenant_id: tenantId,
        phone: phone ?? null,
        email: email ?? null,
        name: contact.name ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async findOrCreateConversation(tenantId: string, identityId: string) {
    const canonicalId = await this.resolveIdentityId(identityId);

    const { data: openConv, error: openError } = await this.db
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("identity_id", canonicalId)
      .eq("status", "open")
      .maybeSingle();

    if (openError) throw openError;
    if (openConv) return openConv;

    const { data, error } = await this.db
      .from("conversations")
      .insert({
        tenant_id: tenantId,
        identity_id: canonicalId,
        status: "open",
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
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
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
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

    if (filters.status) query = query.eq("status", filters.status);
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

    return conversations.map((c) => ({
      ...c,
      identity: identityMap.get(c.identity_id)!,
    }));
  }

  async getConversationThread(conversationId: string): Promise<ConversationThread | null> {
    const { data: conversation, error: convError } = await this.db
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError) throw convError;
    if (!conversation) return null;

    const { data: identity, error: identityError } = await this.db
      .from("identities")
      .select("*")
      .eq("id", conversation.identity_id)
      .single();

    if (identityError) throw identityError;

    const { data: messages, error: msgError } = await this.db
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (msgError) throw msgError;

    return {
      ...conversation,
      identity,
      messages: messages ?? [],
    };
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
