import { generateWidgetKey } from "./chat-session";
import type { AppSupabaseClient } from "../client";
import { createServiceClient, normalizeEmail, normalizePhone } from "../client";
import type { PlatformRole, Tenant, UserRow } from "../types";

export type AdminTenantRow = Tenant & {
  member_count: number;
};

export type AdminUserMembershipSummary = {
  tenant_id: string;
  tenant_name: string;
  role: "admin" | "member";
};

export type AdminUserRow = UserRow & {
  memberships: AdminUserMembershipSummary[];
};

export type UserMembershipInput = {
  tenant_id: string;
  role: "admin" | "member";
};

export class AdminService {
  constructor(private db: AppSupabaseClient) {}

  async getUserPlatformRole(userId: string): Promise<PlatformRole | null> {
    const { data, error } = await this.db
      .from("users")
      .select("platform_role")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data?.platform_role ?? null;
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const role = await this.getUserPlatformRole(userId);
    return role === "super_admin";
  }

  async listAllTenants(): Promise<AdminTenantRow[]> {
    const { data: tenants, error } = await this.db
      .from("tenants")
      .select("*")
      .order("name");

    if (error) throw error;
    if (!tenants?.length) return [];

    const { data: memberships, error: memError } = await this.db
      .from("user_tenant_memberships")
      .select("tenant_id");

    if (memError) throw memError;

    const counts = new Map<string, number>();
    for (const row of memberships ?? []) {
      counts.set(row.tenant_id, (counts.get(row.tenant_id) ?? 0) + 1);
    }

    return tenants.map((tenant) => ({
      ...tenant,
      member_count: counts.get(tenant.id) ?? 0,
    }));
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const { data, error } = await this.db
      .from("tenants")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async createTenant(input: {
    name: string;
    twilio_number: string;
    inbound_email_address: string;
  }): Promise<Tenant> {
    const twilio_number = normalizePhone(input.twilio_number);
    const inbound_email_address = normalizeEmail(input.inbound_email_address);

    const { data, error } = await this.db
      .from("tenants")
      .insert({
        name: input.name.trim(),
        twilio_number,
        inbound_email_address,
        chat_widget_key: generateWidgetKey(),
      })
      .select("*")
      .single();

    if (error) throw error;

    const { error: settingsError } = await this.db.from("tenant_settings").insert({
      tenant_id: data.id,
      greeting_message: null,
      business_hours: {},
      faq_snippets: [],
      auto_reply_sms: false,
    });

    if (settingsError) throw settingsError;
    return data;
  }

  async updateTenant(
    id: string,
    input: {
      name: string;
      twilio_number: string;
      inbound_email_address: string;
    },
  ): Promise<Tenant> {
    const { data, error } = await this.db
      .from("tenants")
      .update({
        name: input.name.trim(),
        twilio_number: normalizePhone(input.twilio_number),
        inbound_email_address: normalizeEmail(input.inbound_email_address),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async listAllUsers(): Promise<AdminUserRow[]> {
    const { data: users, error } = await this.db
      .from("users")
      .select("*")
      .order("email");

    if (error) throw error;
    if (!users?.length) return [];

    const { data: memberships, error: memError } = await this.db
      .from("user_tenant_memberships")
      .select("user_id, tenant_id, role");

    if (memError) throw memError;

    const tenantIds = [...new Set((memberships ?? []).map((m) => m.tenant_id))];
    const tenantMap = new Map<string, string>();

    if (tenantIds.length > 0) {
      const { data: tenants, error: tenantError } = await this.db
        .from("tenants")
        .select("id, name")
        .in("id", tenantIds);

      if (tenantError) throw tenantError;
      for (const t of tenants ?? []) {
        tenantMap.set(t.id, t.name);
      }
    }

    const membershipsByUser = new Map<string, AdminUserMembershipSummary[]>();
    for (const row of memberships ?? []) {
      const list = membershipsByUser.get(row.user_id) ?? [];
      list.push({
        tenant_id: row.tenant_id,
        tenant_name: tenantMap.get(row.tenant_id) ?? row.tenant_id,
        role: row.role,
      });
      membershipsByUser.set(row.user_id, list);
    }

    return users.map((user) => ({
      ...user,
      memberships: membershipsByUser.get(user.id) ?? [],
    }));
  }

  async getUserById(id: string): Promise<AdminUserRow | null> {
    const users = await this.listAllUsers();
    return users.find((u) => u.id === id) ?? null;
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const normalized = normalizeEmail(email);
    const { data, error } = await this.db
      .from("users")
      .select("*")
      .eq("email", normalized)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async createAppUser(input: {
    id: string;
    email: string;
    name?: string | null;
    platform_role?: PlatformRole;
  }): Promise<UserRow> {
    const { data, error } = await this.db
      .from("users")
      .insert({
        id: input.id,
        email: normalizeEmail(input.email),
        name: input.name?.trim() || null,
        platform_role: input.platform_role ?? "user",
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async updateUser(
    id: string,
    input: {
      name?: string | null;
      phone_number?: string | null;
      available_for_calls?: boolean;
      platform_role?: PlatformRole;
    },
  ): Promise<UserRow> {
    const patch: Partial<{
      name: string | null;
      phone_number: string | null;
      available_for_calls: boolean;
      platform_role: PlatformRole;
    }> = {};
    if (input.name !== undefined) patch.name = input.name?.trim() || null;
    if (input.phone_number !== undefined) {
      patch.phone_number = input.phone_number?.trim() || null;
    }
    if (input.available_for_calls !== undefined) {
      patch.available_for_calls = input.available_for_calls;
    }
    if (input.platform_role !== undefined) {
      patch.platform_role = input.platform_role;
    }

    const { data, error } = await this.db
      .from("users")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async setUserTenantMemberships(
    userId: string,
    memberships: UserMembershipInput[],
  ): Promise<void> {
    const { error: deleteError } = await this.db
      .from("user_tenant_memberships")
      .delete()
      .eq("user_id", userId);

    if (deleteError) throw deleteError;

    if (memberships.length === 0) return;

    const { error: insertError } = await this.db
      .from("user_tenant_memberships")
      .insert(
        memberships.map((m) => ({
          user_id: userId,
          tenant_id: m.tenant_id,
          role: m.role,
        })),
      );

    if (insertError) throw insertError;
  }

  async getAdminStats() {
    const [tenants, users] = await Promise.all([
      this.listAllTenants(),
      this.listAllUsers(),
    ]);

    return {
      tenantCount: tenants.length,
      userCount: users.length,
      superAdminCount: users.filter((u) => u.platform_role === "super_admin")
        .length,
    };
  }
}

export function createAdminService(db?: AppSupabaseClient) {
  return new AdminService(db ?? createServiceClient());
}
