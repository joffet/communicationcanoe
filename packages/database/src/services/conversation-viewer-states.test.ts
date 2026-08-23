import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainService } from "./index";
import type { AppSupabaseClient } from "../client";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import {
  conversationAssignees,
  conversationPersonalTags,
  conversationReadStates,
  conversations,
  identities,
  tenants,
  users,
} from "../schema";
import { asResideClientUid, type TenantId } from "@communication-canoe/shared/brands";

let db: TestDb;
let close: () => Promise<void>;
let domain: DomainService;

const VIEWER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  domain = new DomainService(null as unknown as AppSupabaseClient, db);
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTestDb(db);
});

async function seed() {
  const [tenant] = await db.insert(tenants).values({
    name: "Tenant", twilioNumber: "+15550000001",
    inboundEmailAddress: "t@example.test", chatWidgetKey: "key", resideClientUid: asResideClientUid("client"),
  }).returning();
  await db.insert(users).values([
    { id: VIEWER, email: "viewer@example.test", name: "Viewer" },
    { id: OTHER, email: "other@example.test", name: "Other" },
  ]);
  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, email: "customer@example.test",
  }).returning();
  return { tenant, identity };
}

async function makeConversation(
  tenantId: TenantId, identityId: string,
  opts: { lastMessageAt: Date; status?: "open" | "pending" | "resolved" | "merged" },
) {
  const [conversation] = await db.insert(conversations).values({
    tenantId, identityId,
    status: opts.status ?? "open",
    lastMessageAt: opts.lastMessageAt,
  }).returning();
  return conversation;
}

describe("getViewerConversationStates", () => {
  it("marks a conversation unread when the viewer is an assignee with no read cursor", async () => {
    const { tenant, identity } = await seed();
    const c = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-02T00:00:00Z"),
    });
    await db.insert(conversationAssignees).values({
      conversationId: c.id, userId: VIEWER, assignedBy: OTHER,
    });

    const states = await domain.getViewerConversationStates(
      [{ id: c.id, lastMessageAt: c.lastMessageAt }], VIEWER,
    );

    expect(states.get(c.id)).toMatchObject({
      viewer_is_relevant: true, viewer_has_unread: true, viewer_last_read_at: null,
    });
  });

  it("marks a conversation read when the read cursor is at or after the last message", async () => {
    const { tenant, identity } = await seed();
    const lastMessageAt = new Date("2026-08-02T00:00:00Z");
    const c = await makeConversation(tenant.id, identity.id, { lastMessageAt });
    await db.insert(conversationAssignees).values({
      conversationId: c.id, userId: VIEWER, assignedBy: OTHER,
    });
    await db.insert(conversationReadStates).values({
      conversationId: c.id, userId: VIEWER, lastReadAt: lastMessageAt,
    });

    const states = await domain.getViewerConversationStates(
      [{ id: c.id, lastMessageAt: lastMessageAt }], VIEWER,
    );

    expect(states.get(c.id)?.viewer_has_unread).toBe(false);
  });

  it("stays unread when the read cursor predates a newer message", async () => {
    const { tenant, identity } = await seed();
    const c = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-03T00:00:00Z"),
    });
    await db.insert(conversationAssignees).values({
      conversationId: c.id, userId: VIEWER, assignedBy: OTHER,
    });
    await db.insert(conversationReadStates).values({
      conversationId: c.id, userId: VIEWER, lastReadAt: new Date("2026-08-01T00:00:00Z"),
    });

    const states = await domain.getViewerConversationStates(
      [{ id: c.id, lastMessageAt: new Date("2026-08-03T00:00:00.000Z") }], VIEWER,
    );

    expect(states.get(c.id)?.viewer_has_unread).toBe(true);
  });

  it("treats a personal tag as relevant even without an assignee row", async () => {
    const { tenant, identity } = await seed();
    const c = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-02T00:00:00Z"),
    });
    await db.insert(conversationPersonalTags).values({
      conversationId: c.id, userId: VIEWER,
    });

    const states = await domain.getViewerConversationStates(
      [{ id: c.id, lastMessageAt: new Date("2026-08-02T00:00:00.000Z") }], VIEWER,
    );

    expect(states.get(c.id)?.viewer_is_relevant).toBe(true);
  });

  it("is never relevant or unread for a conversation the viewer has no association with", async () => {
    const { tenant, identity } = await seed();
    const c = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-02T00:00:00Z"),
    });
    // Assigned to someone else entirely - relevance is per viewer, and the
    // query filters on user_id rather than returning every assignee row.
    await db.insert(conversationAssignees).values({
      conversationId: c.id, userId: OTHER, assignedBy: OTHER,
    });

    const states = await domain.getViewerConversationStates(
      [{ id: c.id, lastMessageAt: new Date("2026-08-02T00:00:00.000Z") }], VIEWER,
    );

    expect(states.get(c.id)).toMatchObject({
      viewer_is_relevant: false, viewer_has_unread: false,
    });
  });
});

describe("getConversationMetricsForViewer", () => {
  it("counts open vs unread independently and excludes non-relevant and merged conversations", async () => {
    const { tenant, identity } = await seed();

    // Relevant, open, unread.
    const a = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-03T00:00:00Z"),
    });
    // Relevant, resolved, unread - counts toward unread but not open.
    const b = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-03T00:00:00Z"), status: "resolved",
    });
    // Relevant and merged - excluded by the query before relevance is asked.
    const merged = await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-03T00:00:00Z"), status: "merged",
    });
    // Open but not the viewer's.
    await makeConversation(tenant.id, identity.id, {
      lastMessageAt: new Date("2026-08-03T00:00:00Z"),
    });

    for (const c of [a, b, merged]) {
      await db.insert(conversationAssignees).values({
        conversationId: c.id, userId: VIEWER, assignedBy: OTHER,
      });
    }

    const metrics = await domain.getConversationMetricsForViewer(tenant.id, VIEWER);

    expect(metrics).toEqual({ unread_relevant_count: 2, open_relevant_count: 1 });
  });

  it("returns zeroes for a tenant with no conversations", async () => {
    const { tenant } = await seed();

    const metrics = await domain.getConversationMetricsForViewer(tenant.id, VIEWER);

    expect(metrics).toEqual({ unread_relevant_count: 0, open_relevant_count: 0 });
  });
});
