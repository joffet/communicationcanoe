import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { conversations, identities, tenants } from "../schema";
import { asResideClientUid } from "@communication-canoe/shared/brands";

let db: TestDb;
let close: () => Promise<void>;
let domain: DomainService;

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
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: "Tenant",
      twilioNumber: "+15550000001",
      inboundEmailAddress: "t@example.test",
      chatWidgetKey: "key",
      resideClientUid: asResideClientUid("client"),
    })
    .returning();
  const [identity] = await db
    .insert(identities)
    .values({ tenantId: tenant.id, email: "resident@example.test" })
    .returning();
  return { tenant, identity };
}

describe("findOrCreateConversation forceNew", () => {
  it("continues the open conversation by default", async () => {
    const { tenant, identity } = await seed();
    const [existing] = await db
      .insert(conversations)
      .values({ tenantId: tenant.id, identityId: identity.id, status: "open" })
      .returning();

    const { conversation } = await domain.findOrCreateConversation(tenant.id, identity.id, {
      channel: "email",
    });

    expect(conversation.id).toBe(existing.id);
  });

  it("starts a fresh thread when asked, leaving the open one alone", async () => {
    // The reason this option exists: "send this to my inbox" means its own
    // thread, and without it the message lands in whatever unrelated
    // conversation happened to be open with that person.
    const { tenant, identity } = await seed();
    const [existing] = await db
      .insert(conversations)
      .values({ tenantId: tenant.id, identityId: identity.id, status: "open" })
      .returning();

    const { conversation } = await domain.findOrCreateConversation(tenant.id, identity.id, {
      channel: "web_chat",
      forceNew: true,
    });

    expect(conversation.id).not.toBe(existing.id);
    expect(conversation.identityId).toBe(identity.id);
    expect(conversation.status).toBe("open");

    // The one it declined to use is still there and still open.
    const rows = await db.select().from(conversations);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "open")).toBe(true);
  });

  it("creates a distinct thread on every call", async () => {
    // Two "send to my inbox" presses are two threads, not one thread found
    // twice - which is what would happen if forceNew searched first.
    const { tenant, identity } = await seed();

    const first = await domain.findOrCreateConversation(tenant.id, identity.id, { forceNew: true });
    const second = await domain.findOrCreateConversation(tenant.id, identity.id, { forceNew: true });

    expect(first.conversation.id).not.toBe(second.conversation.id);
    expect(first.isStale).toBe(false);
    expect(second.isStale).toBe(false);
  });

  it("still creates one when there is nothing to continue", async () => {
    const { tenant, identity } = await seed();
    const { conversation } = await domain.findOrCreateConversation(tenant.id, identity.id, {
      forceNew: true,
    });
    expect(conversation.id).toBeTruthy();
  });
});
