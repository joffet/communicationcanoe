import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainService } from "./index";
import type { AppSupabaseClient } from "../client";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { conversations, identities, tenants, users } from "../schema";

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
    inboundEmailAddress: "t@example.test", chatWidgetKey: "key", resideClientUid: "client",
  }).returning();
  await db.insert(users).values([
    { id: VIEWER, email: "viewer@example.test", name: "Viewer" },
    { id: OTHER, email: "other@example.test", name: "Other" },
  ]);
  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, email: "customer@example.test",
  }).returning();
  const [conversation] = await db.insert(conversations).values({
    tenantId: tenant.id, identityId: identity.id, status: "open",
  }).returning();
  return { tenant, identity, conversation };
}

describe("tags", () => {
  it("creates and lists a tenant's tags by name", async () => {
    const { tenant } = await seed();

    await domain.createTag(tenant.id, "urgent", "#ff0000");
    await domain.createTag(tenant.id, "billing");

    const listed = await domain.listTenantTags(tenant.id);

    expect(listed.map((t) => t.name)).toEqual(["billing", "urgent"]);
    expect(listed.find((t) => t.name === "billing")?.color).toBeNull();
  });

  it("does not list another tenant's tags", async () => {
    const { tenant } = await seed();
    const [other] = await db.insert(tenants).values({
      name: "Other", twilioNumber: "+15550000009",
      inboundEmailAddress: "o@example.test", chatWidgetKey: "key-o", resideClientUid: "client-o",
    }).returning();

    await domain.createTag(other.id, "theirs");

    expect(await domain.listTenantTags(tenant.id)).toEqual([]);
  });
});

describe("addConversationAssignee", () => {
  it("is idempotent and refreshes who assigned it", async () => {
    const { conversation } = await seed();

    const first = await domain.addConversationAssignee(conversation.id, VIEWER, OTHER);
    expect(first.assignedBy).toBe(OTHER);

    // Re-assigning someone already assigned must not fail on the composite
    // key. It also records whoever most recently did it.
    const second = await domain.addConversationAssignee(conversation.id, VIEWER, VIEWER);
    expect(second.assignedBy).toBe(VIEWER);

    const listed = await domain.listConversationAssignees(conversation.id);
    expect(listed).toHaveLength(1);
  });
});

describe("conversation participants", () => {
  it("records an identity participant as external and a user as internal", async () => {
    const { conversation, identity } = await seed();

    const external = await domain.addConversationParticipant(conversation.id, {
      identityId: identity.id,
    });
    const internal = await domain.addConversationParticipant(conversation.id, {
      userId: VIEWER,
    });

    expect(external).toMatchObject({ role: "external", identityId: identity.id, userId: null });
    expect(internal).toMatchObject({ role: "internal", userId: VIEWER, identityId: null });

    const listed = await domain.listConversationParticipants(conversation.id);
    expect(listed).toHaveLength(2);
  });
});

describe("live transfers", () => {
  it("keeps the AI's escalation reason and stops reporting it once answered", async () => {
    const { tenant, conversation } = await seed();

    const transfer = await domain.logLiveTransfer({
      tenantId: tenant.id,
      conversationId: conversation.id,
      channel: "web_chat",
      outcome: "pending",
      reason: "Visitor asked for a human about a billing dispute",
    });
    expect(transfer.reason).toBe("Visitor asked for a human about a billing dispute");

    const pending = await domain.getPendingLiveTransfer(conversation.id, tenant.id);
    expect(pending?.id).toBe(transfer.id);

    await domain.updateLiveTransferOutcome(transfer.id, "answered", VIEWER);
    expect(await domain.getPendingLiveTransfer(conversation.id, tenant.id)).toBeNull();
  });

  it("logs a transfer with no reason, since the voice failure path has none", async () => {
    const { tenant, conversation } = await seed();

    const transfer = await domain.logLiveTransfer({
      tenantId: tenant.id,
      conversationId: conversation.id,
      channel: "voice",
      outcome: "no_answer",
    });

    expect(transfer.reason).toBeNull();
  });
});
