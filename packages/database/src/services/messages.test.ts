import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { conversations, identities, messages, tenantSettings, tenants } from "../schema";
import { asResideClientUid, type TenantId } from "@communication-canoe/shared/brands";

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
  const [tenant] = await db.insert(tenants).values({
    name: "Tenant", twilioNumber: "+15550000001",
    inboundEmailAddress: "t@example.test", chatWidgetKey: "key", resideClientUid: asResideClientUid("client"),
  }).returning();
  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, email: "customer@example.test",
  }).returning();
  const [conversation] = await db.insert(conversations).values({
    tenantId: tenant.id, identityId: identity.id, status: "open",
  }).returning();
  return { tenant, identity, conversation };
}

function baseMessage(tenantId: TenantId, conversationId: string) {
  return {
    tenantId, conversationId,
    channel: "email" as const,
    direction: "inbound" as const,
    senderType: "external" as const,
    body: "hello",
  };
}

describe("appendMessage triggers", () => {
  /**
   * Both of these are AFTER INSERT triggers on `messages`, so they fire on the
   * row rather than in whichever client wrote it. Worth asserting anyway:
   * "the database still does it" was an assumption when this moved off
   * supabase-js, and an assumption about a trigger is exactly the kind that
   * holds until someone regenerates a schema without it.
   */
  it("advances the conversation's last_message_at", async () => {
    const { tenant, conversation } = await seed();
    // last_message_at is NOT NULL with a now() default, so a fresh conversation
    // already has one - the trigger has to move it, not merely set it.
    const before = conversation.lastMessageAt;

    const message = await domain.appendMessage(baseMessage(tenant.id, conversation.id));

    const [after] = await db.select().from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(after.lastMessageAt).toEqual(message.createdAt);
    expect(after.lastMessageAt).not.toEqual(before);
  });

  it("starts the SLA response clock on an inbound external message", async () => {
    const { tenant, conversation } = await seed();
    await db.insert(tenantSettings).values({
      tenantId: tenant.id, defaultResponseWindowMinutes: 30,
    });

    await domain.appendMessage({
      ...baseMessage(tenant.id, conversation.id),
      visibility: "external",
    });

    const [after] = await db.select().from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(after.responseDueAt).not.toBeNull();
  });

  it("clears the response clock when the reply goes out", async () => {
    const { tenant, conversation } = await seed();
    await db.insert(tenantSettings).values({
      tenantId: tenant.id, defaultResponseWindowMinutes: 30,
    });

    await domain.appendMessage({
      ...baseMessage(tenant.id, conversation.id), visibility: "external",
    });
    await domain.appendMessage({
      ...baseMessage(tenant.id, conversation.id),
      direction: "outbound", senderType: "internal_user", visibility: "external",
    });

    const [after] = await db.select().from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(after.responseDueAt).toBeNull();
  });

  it("leaves the clock alone for an internal note", async () => {
    const { tenant, conversation } = await seed();
    await db.insert(tenantSettings).values({
      tenantId: tenant.id, defaultResponseWindowMinutes: 30,
    });

    // visibility defaults to 'internal', and the trigger only starts the clock
    // for external traffic - a note to a colleague is not a customer waiting.
    await domain.appendMessage(baseMessage(tenant.id, conversation.id));

    const [after] = await db.select().from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(after.responseDueAt).toBeNull();
  });
});

describe("claimScheduledMessage", () => {
  it("claims a queued approved message once and refuses the second attempt", async () => {
    const { tenant, conversation } = await seed();
    const message = await domain.appendMessage({
      ...baseMessage(tenant.id, conversation.id),
      deliveryStatus: "queued",
      aiReviewStatus: "approved",
    });

    const first = await domain.claimScheduledMessage(message.id);
    expect(first?.deliveryStatus).toBe("sending");

    // The status predicate inside the UPDATE is the whole double-send guard:
    // a second worker matches nothing rather than sending again.
    expect(await domain.claimScheduledMessage(message.id)).toBeNull();
  });

  it("refuses a message that has not been approved", async () => {
    const { tenant, conversation } = await seed();
    const message = await domain.appendMessage({
      ...baseMessage(tenant.id, conversation.id),
      deliveryStatus: "queued",
      aiReviewStatus: "flagged",
    });

    expect(await domain.claimScheduledMessage(message.id)).toBeNull();
  });
});

describe("updateMessageDeliveryStatus", () => {
  it("increments the attempt count in SQL rather than from a snapshot", async () => {
    const { tenant, conversation } = await seed();
    const message = await domain.appendMessage(baseMessage(tenant.id, conversation.id));

    // Concurrent delivery webhooks are the reason this is a SQL expression:
    // two reads of the same snapshot would both write 1.
    await Promise.all([
      domain.updateMessageDeliveryStatus(message.id, {
        deliveryStatus: "sent", incrementAttempts: true,
      }),
      domain.updateMessageDeliveryStatus(message.id, {
        deliveryStatus: "sent", incrementAttempts: true,
      }),
    ]);

    const after = await domain.getMessageById(message.id);
    expect(after?.deliveryAttempts).toBe(2);
  });
});

describe("markMessageOpened", () => {
  /**
   * reside forwards only the FIRST open into its notification inbox, and it
   * decides that from this return value. An image proxy re-fetches the pixel
   * every time a message is displayed, so if this reported true each time,
   * reside would receive a steady stream of calls all describing one event.
   */
  it("reports the first open, and not the ones after it", async () => {
    const { tenant, conversation } = await seed();
    const message = await domain.appendMessage(baseMessage(tenant.id, conversation.id));

    const first = await domain.markMessageOpened(message.id);
    expect(first.firstOpen).toBe(true);

    const second = await domain.markMessageOpened(message.id);
    expect(second.firstOpen).toBe(false);
  });

  it("keeps the original timestamp when the pixel is fetched again", async () => {
    const { tenant, conversation } = await seed();
    const message = await domain.appendMessage(baseMessage(tenant.id, conversation.id));

    await domain.markMessageOpened(message.id);
    const [afterFirst] = await db.select().from(messages).where(eq(messages.id, message.id));
    await domain.markMessageOpened(message.id);
    const [afterSecond] = await db.select().from(messages).where(eq(messages.id, message.id));

    expect(afterSecond.openedAt).toEqual(afterFirst.openedAt);
  });

  it("reports false for a message id that does not exist", async () => {
    // reside sends every open it hears about; an id matching nothing must not
    // look like a recorded open.
    const result = await domain.markMessageOpened("00000000-0000-0000-0000-000000000000");
    expect(result.firstOpen).toBe(false);
  });
});
