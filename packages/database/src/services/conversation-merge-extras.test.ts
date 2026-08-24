import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import {
  conversationAssignees,
  conversationPersonalTags,
  conversationReadStates,
  conversationTags,
  conversations,
  identities,
  tags,
  tenants,
  users,
} from "../schema";
import { asResideClientUid } from "@communication-canoe/shared/brands";

let db: TestDb;
let close: () => Promise<void>;
let domain: DomainService;

const ADMIN_1 = "11111111-1111-1111-1111-111111111111";
const ADMIN_2 = "22222222-2222-2222-2222-222222222222";

/** Exercised directly rather than through the public mergeConversations,
 * because that entry point also rewrites conversations.merged_into_id and
 * broadcasts - neither of which this is about. */
function moveExtras(sourceId: string, targetId: string): Promise<void> {
  return (domain as unknown as { moveConversationExtras: (s: string, t: string) => Promise<void> })
    .moveConversationExtras(sourceId, targetId);
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  domain = new DomainService(db);
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
    { id: ADMIN_1, email: "a1@example.test", name: "Admin One" },
    { id: ADMIN_2, email: "a2@example.test", name: "Admin Two" },
  ]);
  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, email: "customer@example.test",
  }).returning();
  const [source] = await db.insert(conversations).values({
    tenantId: tenant.id, identityId: identity.id, status: "open",
  }).returning();
  const [target] = await db.insert(conversations).values({
    tenantId: tenant.id, identityId: identity.id, status: "open",
  }).returning();
  const [tag] = await db.insert(tags).values({ tenantId: tenant.id, name: "urgent" }).returning();
  return { tenant, identity, source, target, tag };
}

describe("moveConversationExtras", () => {
  it("moves tags, assignees, and personal tags from source onto target", async () => {
    const { source, target, tag } = await seed();
    await db.insert(conversationTags).values({ conversationId: source.id, tagId: tag.id });
    await db.insert(conversationAssignees).values({
      conversationId: source.id, userId: ADMIN_1, assignedBy: ADMIN_2,
    });
    await db.insert(conversationPersonalTags).values({
      conversationId: source.id, userId: ADMIN_1,
    });

    await moveExtras(source.id, target.id);

    expect(await db.select().from(conversationTags).where(eq(conversationTags.conversationId, target.id)))
      .toMatchObject([{ tagId: tag.id }]);
    expect(await db.select().from(conversationAssignees).where(eq(conversationAssignees.conversationId, target.id)))
      .toMatchObject([{ userId: ADMIN_1, assignedBy: ADMIN_2 }]);
    expect(await db.select().from(conversationPersonalTags).where(eq(conversationPersonalTags.conversationId, target.id)))
      .toMatchObject([{ userId: ADMIN_1 }]);
  });

  it("dedupes a tag, assignee and personal tag that already exists on the target", async () => {
    const { source, target, tag } = await seed();
    for (const conversationId of [source.id, target.id]) {
      await db.insert(conversationTags).values({ conversationId, tagId: tag.id });
      await db.insert(conversationAssignees).values({
        conversationId, userId: ADMIN_1, assignedBy: ADMIN_2,
      });
      await db.insert(conversationPersonalTags).values({ conversationId, userId: ADMIN_1 });
    }

    await moveExtras(source.id, target.id);

    expect(await db.select().from(conversationTags).where(eq(conversationTags.conversationId, target.id)))
      .toHaveLength(1);
    expect(await db.select().from(conversationAssignees).where(eq(conversationAssignees.conversationId, target.id)))
      .toHaveLength(1);
    expect(await db.select().from(conversationPersonalTags).where(eq(conversationPersonalTags.conversationId, target.id)))
      .toHaveLength(1);
  });

  it("deletes every moved row from the source conversation", async () => {
    const { source, target, tag } = await seed();
    await db.insert(conversationTags).values({ conversationId: source.id, tagId: tag.id });
    await db.insert(conversationAssignees).values({
      conversationId: source.id, userId: ADMIN_1, assignedBy: ADMIN_2,
    });
    await db.insert(conversationPersonalTags).values({ conversationId: source.id, userId: ADMIN_1 });
    await db.insert(conversationReadStates).values({
      conversationId: source.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-01T00:00:00Z"),
    });

    await moveExtras(source.id, target.id);

    expect(await db.select().from(conversationTags).where(eq(conversationTags.conversationId, source.id))).toEqual([]);
    expect(await db.select().from(conversationAssignees).where(eq(conversationAssignees.conversationId, source.id))).toEqual([]);
    expect(await db.select().from(conversationPersonalTags).where(eq(conversationPersonalTags.conversationId, source.id))).toEqual([]);
    expect(await db.select().from(conversationReadStates).where(eq(conversationReadStates.conversationId, source.id))).toEqual([]);
  });

  it("moves a read cursor that only exists on the source", async () => {
    const { source, target } = await seed();
    await db.insert(conversationReadStates).values({
      conversationId: source.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-02T00:00:00Z"),
    });

    await moveExtras(source.id, target.id);

    const [state] = await db.select().from(conversationReadStates)
      .where(eq(conversationReadStates.conversationId, target.id));
    expect(state.lastReadAt).toEqual(new Date("2026-08-02T00:00:00Z"));
  });

  it("keeps the target's read cursor when it is newer than the source's for the same user", async () => {
    const { source, target } = await seed();
    await db.insert(conversationReadStates).values([
      { conversationId: source.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-01T00:00:00Z") },
      { conversationId: target.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-05T00:00:00Z") },
    ]);

    await moveExtras(source.id, target.id);

    const [state] = await db.select().from(conversationReadStates)
      .where(eq(conversationReadStates.conversationId, target.id));
    expect(state.lastReadAt).toEqual(new Date("2026-08-05T00:00:00Z"));
  });

  it("adopts the source's read cursor when it is newer than the target's for the same user", async () => {
    const { source, target } = await seed();
    await db.insert(conversationReadStates).values([
      { conversationId: source.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-09T00:00:00Z") },
      { conversationId: target.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-02T00:00:00Z") },
    ]);

    await moveExtras(source.id, target.id);

    const [state] = await db.select().from(conversationReadStates)
      .where(eq(conversationReadStates.conversationId, target.id));
    expect(state.lastReadAt).toEqual(new Date("2026-08-09T00:00:00Z"));
  });

  it("keeps independent read cursors for different users, taking the max per user", async () => {
    const { source, target } = await seed();
    await db.insert(conversationReadStates).values([
      { conversationId: source.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-09T00:00:00Z") },
      { conversationId: target.id, userId: ADMIN_1, lastReadAt: new Date("2026-08-02T00:00:00Z") },
      { conversationId: target.id, userId: ADMIN_2, lastReadAt: new Date("2026-08-07T00:00:00Z") },
    ]);

    await moveExtras(source.id, target.id);

    const states = await db.select().from(conversationReadStates)
      .where(eq(conversationReadStates.conversationId, target.id));
    const byUser = new Map(states.map((s) => [s.userId, s.lastReadAt]));
    expect(byUser.get(ADMIN_1)).toEqual(new Date("2026-08-09T00:00:00Z"));
    expect(byUser.get(ADMIN_2)).toEqual(new Date("2026-08-07T00:00:00Z"));
  });
});
