import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainService } from "./index";
import type { AppSupabaseClient } from "../client";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { conversationReadStates, conversations, identities, messages, tenants, users } from "../schema";

let db: TestDb;
let close: () => Promise<void>;
let domain: DomainService;

const VIEWER = "11111111-1111-1111-1111-111111111111";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  // Null supabase-js client: this method is converted, so reaching for the old
  // client crashes rather than quietly passing.
  domain = new DomainService(null as unknown as AppSupabaseClient, db);
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTestDb(db);
});

/** A tenant, a viewer, an identity and a conversation - the minimum a read
 * state can hang off, given every one of those is a foreign key. The fake
 * required none of them, which is the difference: rows here have to be
 * consistent with the schema, not merely present. */
async function seed() {
  const [tenant] = await db.insert(tenants).values({
    name: "Tenant", twilioNumber: "+15550000001",
    inboundEmailAddress: "t@example.test", chatWidgetKey: "key", resideClientUid: "client",
  }).returning();

  await db.insert(users).values({ id: VIEWER, email: "viewer@example.test", name: "Viewer" });

  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, email: "customer@example.test",
  }).returning();

  return { tenant, identity };
}

async function makeConversation(tenantId: string, identityId: string) {
  const [conversation] = await db.insert(conversations).values({
    tenantId, identityId, status: "open",
  }).returning();
  return conversation;
}

async function addMessage(
  tenantId: string, conversationId: string, createdAt: Date, body: string,
) {
  const [message] = await db.insert(messages).values({
    tenantId, conversationId, channel: "email", direction: "inbound",
    senderType: "external", body, createdAt,
  }).returning();
  return message;
}

describe("markConversationRead", () => {
  it("advances the cursor to the newest message and is idempotent on repeat calls", async () => {
    const { tenant, identity } = await seed();
    const conversation = await makeConversation(tenant.id, identity.id);
    await addMessage(tenant.id, conversation.id, new Date("2026-08-01T00:00:00Z"), "older");
    const newest = await addMessage(
      tenant.id, conversation.id, new Date("2026-08-02T00:00:00Z"), "newer",
    );

    const first = await domain.markConversationRead(conversation.id, VIEWER);
    expect(first.lastReadMessageId).toBe(newest.id);

    // The upsert's whole purpose: opening the same conversation twice must
    // move the cursor, not fail on the composite primary key.
    const second = await domain.markConversationRead(conversation.id, VIEWER);
    expect(second.lastReadMessageId).toBe(newest.id);

    const rows = await db
      .select()
      .from(conversationReadStates)
      .where(eq(conversationReadStates.userId, VIEWER));
    expect(rows).toHaveLength(1);
  });

  it("reads across the whole merge chain, not just the conversation id passed in", async () => {
    const { tenant, identity } = await seed();
    const target = await makeConversation(tenant.id, identity.id);
    const source = await makeConversation(tenant.id, identity.id);

    await addMessage(tenant.id, target.id, new Date("2026-08-01T00:00:00Z"), "older, on target");
    const newest = await addMessage(
      tenant.id, source.id, new Date("2026-08-03T00:00:00Z"), "newer, on source",
    );

    // A real merge rather than a stubbed chain lookup: conversation_merge_chain_ids
    // is a Postgres function walking merged_into_id, so the fake had to
    // simulate what it returned. Here it runs.
    await db
      .update(conversations)
      .set({ mergedIntoId: target.id, status: "merged" })
      .where(eq(conversations.id, source.id));

    const readState = await domain.markConversationRead(target.id, VIEWER);

    expect(readState.lastReadMessageId).toBe(newest.id);
  });

  it("still records a read state for a conversation with no messages", async () => {
    const { tenant, identity } = await seed();
    const conversation = await makeConversation(tenant.id, identity.id);

    const readState = await domain.markConversationRead(conversation.id, VIEWER);

    expect(readState.lastReadMessageId).toBeNull();
    expect(readState.lastReadAt).toBeInstanceOf(Date);
  });
});
