import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { generateWidgetKey } from "./chat-session";
import { createDb, type Db } from "../db";
import { normalizeEmail, normalizePhone } from "../client";
import { tenantSettings, tenants, userTenantMemberships, users } from "../schema";
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
  #orm?: Db;

  constructor(ormOverride?: Db) {
    this.#orm = ormOverride;
  }

  protected get orm(): Db {
    return (this.#orm ??= createDb());
  }

  async getUserPlatformRole(userId: string): Promise<PlatformRole | null> {
    const [user] = await this.orm
      .select({ platformRole: users.platformRole })
      .from(users).where(eq(users.id, userId)).limit(1);
    return user?.platformRole ?? null;
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const role = await this.getUserPlatformRole(userId);
    return role === "super_admin";
  }

  async listAllTenants(): Promise<AdminTenantRow[]> {
    const rows = await this.orm.select().from(tenants).orderBy(asc(tenants.name));
    if (!rows.length) return [];

    const memberships = await this.orm
      .select({ tenantId: userTenantMemberships.tenantId })
      .from(userTenantMemberships);

    const counts = new Map<string, number>();
    for (const row of memberships) {
      counts.set(row.tenantId, (counts.get(row.tenantId) ?? 0) + 1);
    }

    return rows.map((tenant) => ({
      ...tenant,
      member_count: counts.get(tenant.id) ?? 0,
    }));
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const [tenant] = await this.orm
      .select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return tenant ?? null;
  }

  /** Resolves a tenant by reside's own client identifier - the value reside sends
   * on every inbound request. Use this (never getTenantById) for anything driven
   * by a reside-supplied uid: that uid may be a slug like "cardiff", and
   * getTenantById compares against a uuid column, which Postgres rejects with a
   * cast error rather than simply not matching. */
  async getTenantByResideClientUid(resideClientUid: string): Promise<Tenant | null> {
    const [tenant] = await this.orm
      .select().from(tenants)
      .where(eq(tenants.resideClientUid, resideClientUid)).limit(1);
    return tenant ?? null;
  }

  /** Keeps comm-canoe's copy of the client's portal URL in step when a reside
   * admin edits their routing domain. Idempotent; safe to call on every save. */
  async updateTenantResideAppUrl(resideClientUid: string, resideAppUrl: string | null): Promise<void> {
    await this.orm
      .update(tenants).set({ resideAppUrl })
      .where(eq(tenants.resideClientUid, resideClientUid));
  }

  async createTenant(input: {
    id?: string;
    name: string;
    twilio_number: string;
    inbound_email_address: string;
    provisioning_source?: "manual" | "reside";
    /** reside's client uid. Defaults to `id` only for manually-created tenants
     * that predate the split; reside-provisioned tenants always pass it. */
    reside_client_uid?: string;
    reside_app_url?: string | null;
  }): Promise<Tenant> {
    const twilio_number = normalizePhone(input.twilio_number);
    const inbound_email_address = normalizeEmail(input.inbound_email_address);
    const id = input.id ?? randomUUID();
    const reside_client_uid = input.reside_client_uid ?? id;

    // One transaction: a tenant with no settings row is a tenant whose SLA
    // window and greeting read as undefined everywhere downstream.
    return this.orm.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          id,
          name: input.name.trim(),
          twilioNumber: twilio_number,
          inboundEmailAddress: inbound_email_address,
          // NOT NULL with no database default, so it has to be supplied here.
          chatWidgetKey: generateWidgetKey(),
          provisioningSource: input.provisioning_source ?? "manual",
          resideClientUid: reside_client_uid,
          resideAppUrl: input.reside_app_url ?? null,
        })
        .returning();

      await tx.insert(tenantSettings).values({
        tenantId: tenant.id,
        greetingMessage: null,
        businessHours: {},
        faqSnippets: [],
        autoReplySms: false,
      });

      return tenant;
    });
  }

  async updateTenant(
    id: string,
    input: {
      name: string;
      twilio_number: string;
      inbound_email_address: string;
    },
  ): Promise<Tenant> {
    const [tenant] = await this.orm
      .update(tenants)
      .set({
        name: input.name.trim(),
        twilioNumber: normalizePhone(input.twilio_number),
        inboundEmailAddress: normalizeEmail(input.inbound_email_address),
      })
      .where(eq(tenants.id, id))
      .returning();
    return tenant;
  }

  async listAllUsers(): Promise<AdminUserRow[]> {
    const rows = await this.orm.select().from(users).orderBy(asc(users.email));
    if (!rows.length) return [];

    const memberships = await this.orm
      .select({
        userId: userTenantMemberships.userId,
        tenantId: userTenantMemberships.tenantId,
        role: userTenantMemberships.role,
      })
      .from(userTenantMemberships);

    const tenantIds = [...new Set(memberships.map((m) => m.tenantId))];
    const tenantMap = new Map<string, string>();

    if (tenantIds.length > 0) {
      const tenantRows = await this.orm
        .select({ id: tenants.id, name: tenants.name })
        .from(tenants).where(inArray(tenants.id, tenantIds));
      for (const t of tenantRows) tenantMap.set(t.id, t.name);
    }

    const membershipsByUser = new Map<string, AdminUserMembershipSummary[]>();
    for (const row of memberships) {
      const list = membershipsByUser.get(row.userId) ?? [];
      list.push({
        tenant_id: row.tenantId,
        // Falls back to the id so a membership pointing at a deleted tenant
        // still renders as something rather than an empty cell.
        tenant_name: tenantMap.get(row.tenantId) ?? row.tenantId,
        role: row.role,
      });
      membershipsByUser.set(row.userId, list);
    }

    return rows.map((user) => ({
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
    const [user] = await this.orm
      .select().from(users).where(eq(users.email, normalized)).limit(1);
    return user ?? null;
  }

  async createAppUser(input: {
    id: string;
    email: string;
    name?: string | null;
    platform_role?: PlatformRole;
  }): Promise<UserRow> {
    const [user] = await this.orm
      .insert(users)
      .values({
        id: input.id,
        email: normalizeEmail(input.email),
        name: input.name?.trim() || null,
        platformRole: input.platform_role ?? "user",
      })
      .returning();
    return user;
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
    // Built key by key rather than spread: an undefined field must mean "leave
    // it alone", and passing it through would null the column instead.
    const patch: Partial<{
      name: string | null;
      phoneNumber: string | null;
      availableForCalls: boolean;
      platformRole: PlatformRole;
    }> = {};
    if (input.name !== undefined) patch.name = input.name?.trim() || null;
    if (input.phone_number !== undefined) {
      patch.phoneNumber = input.phone_number?.trim() || null;
    }
    if (input.available_for_calls !== undefined) {
      patch.availableForCalls = input.available_for_calls;
    }
    if (input.platform_role !== undefined) {
      patch.platformRole = input.platform_role;
    }

    const [user] = await this.orm
      .update(users).set(patch).where(eq(users.id, id)).returning();
    return user;
  }

  async setUserTenantMemberships(
    userId: string,
    memberships: UserMembershipInput[],
  ): Promise<void> {
    // Replace-the-set in one transaction: between the delete and the insert
    // the user belongs to nothing, and a failure there would strand them
    // without access rather than leaving their old memberships in place.
    await this.orm.transaction(async (tx) => {
      await tx.delete(userTenantMemberships)
        .where(eq(userTenantMemberships.userId, userId));

      if (memberships.length === 0) return;

      await tx.insert(userTenantMemberships).values(
        memberships.map((m) => ({
          userId,
          tenantId: m.tenant_id,
          role: m.role,
        })),
      );
    });
  }

  /**
   * Adds/updates a single membership without touching the user's other tenants —
   * unlike setUserTenantMemberships, which replaces the full set.
   */
  async upsertTenantMembership(
    userId: string,
    tenantId: string,
    role: "admin" | "member",
  ): Promise<void> {
    await this.orm
      .insert(userTenantMemberships)
      .values({ userId, tenantId, role })
      .onConflictDoUpdate({
        target: [userTenantMemberships.userId, userTenantMemberships.tenantId],
        set: { role },
      });
  }

  async getAdminStats() {
    const [allTenants, allUsers] = await Promise.all([
      this.listAllTenants(),
      this.listAllUsers(),
    ]);

    return {
      tenantCount: allTenants.length,
      userCount: allUsers.length,
      superAdminCount: allUsers.filter((u) => u.platformRole === "super_admin")
        .length,
    };
  }
}

export function createAdminService(orm?: Db) {
  return new AdminService(orm);
}
