import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { outboundBatches, outboundBatchRecipients, tenants } from "../schema";
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

async function makeTenant(suffix: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: `Tenant ${suffix}`,
      twilioNumber: `+1555000000${suffix}`,
      inboundEmailAddress: `${suffix}@example.test`,
      chatWidgetKey: `key-${suffix}`,
      resideClientUid: asResideClientUid(`client-${suffix}`),
    })
    .returning();
  return tenant;
}

async function makeBatch(tenantId: TenantId) {
  const [batch] = await db
    .insert(outboundBatches)
    .values({ tenantId, channel: "email", status: "pending", totalRecipients: 1 })
    .returning();
  await db.insert(outboundBatchRecipients).values({
    batchId: batch.id,
    tenantId,
    channel: "email",
    body: "hello",
    identityContact: { email: "someone@example.test" },
    status: "pending",
  });
  return batch;
}

describe("getOutboundBatchDetail", () => {
  /**
   * The regression test for the bug this endpoint shipped with: it took only a
   * batch id, so any caller holding the shared RESIDE_API_SECRET could read
   * another building's recipient list - contact addresses, delivery outcomes,
   * open timestamps - knowing nothing but the id.
   *
   * It survived for months because the only tests available ran against an
   * in-memory fake, which cannot show whether a tenant predicate reached the
   * database. This one can.
   */
  it("does not return a batch belonging to another tenant", async () => {
    const tenantA = await makeTenant("1");
    const tenantB = await makeTenant("2");
    const batchOfA = await makeBatch(tenantA.id);

    const leaked = await domain.getOutboundBatchDetail(batchOfA.id, tenantB.id);

    expect(leaked).toBeNull();
  });

  it("returns the batch and its recipients to the owning tenant", async () => {
    const tenant = await makeTenant("1");
    const batch = await makeBatch(tenant.id);

    const detail = await domain.getOutboundBatchDetail(batch.id, tenant.id);

    expect(detail?.batch.id).toBe(batch.id);
    expect(detail?.recipients).toHaveLength(1);
    expect(detail?.recipients[0]?.identityContact).toEqual({ email: "someone@example.test" });
  });

  it("returns null for a batch that does not exist", async () => {
    const tenant = await makeTenant("1");

    const detail = await domain.getOutboundBatchDetail(
      "00000000-0000-0000-0000-000000000000",
      tenant.id,
    );

    // Same answer as another tenant's batch, deliberately: a caller probing
    // ids cannot tell "not yours" from "no such thing".
    expect(detail).toBeNull();
  });

  it("carries delivery status through from the recipient's message", async () => {
    const tenant = await makeTenant("1");
    const batch = await makeBatch(tenant.id);

    const detail = await domain.getOutboundBatchDetail(batch.id, tenant.id);

    // No message linked yet, so the delivery fields are absent rather than
    // missing keys - the reside-facing route maps them straight into its JSON.
    expect(detail?.recipients[0]).toMatchObject({
      deliveryStatus: null,
      deliveryError: null,
      openedAt: null,
    });
  });
});

describe("incrementOutboundBatchCompleted", () => {
  async function batchOf(tenantId: TenantId, total: number) {
    const [batch] = await db
      .insert(outboundBatches)
      .values({ tenantId, channel: "email", status: "pending", totalRecipients: total })
      .returning();
    return batch;
  }

  /**
   * The reason this had to stop being a read-then-write before the drain could
   * run recipients in parallel.
   *
   * Two finishers reading the same count and both writing it plus one loses a
   * tick - and because the status flips to "completed" by comparing that count
   * to the total, a batch that undercounts even once never completes at all.
   * Reside polls exactly that field, so the batch would sit in "processing"
   * forever with every recipient already delivered.
   */
  it("counts every finisher when several land at once", async () => {
    const tenant = await makeTenant("c1");
    const batch = await batchOf(tenant.id, 10);

    await Promise.all(
      Array.from({ length: 10 }, () => domain.incrementOutboundBatchCompleted(batch.id)),
    );

    const done = await domain.getOutboundBatch(batch.id);
    expect(done?.completedRecipients).toBe(10);
    // And the status is derived from the value that was actually written.
    expect(done?.status).toBe("completed");
    expect(done?.completedAt).toBeTruthy();
  });

  it("stays in processing until the last recipient lands", async () => {
    const tenant = await makeTenant("c2");
    const batch = await batchOf(tenant.id, 3);

    await domain.incrementOutboundBatchCompleted(batch.id);
    await domain.incrementOutboundBatchCompleted(batch.id);
    let mid = await domain.getOutboundBatch(batch.id);
    expect(mid?.status).toBe("processing");
    expect(mid?.completedAt).toBeNull();

    await domain.incrementOutboundBatchCompleted(batch.id);
    mid = await domain.getOutboundBatch(batch.id);
    expect(mid?.status).toBe("completed");
  });

  /* An UPDATE matching nothing succeeds, so without the returning check the
   * caller never learns the batch it is counting against does not exist. */
  it("reports an unknown batch rather than succeeding silently", async () => {
    await expect(
      domain.incrementOutboundBatchCompleted("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/Unknown outbound batch/);
  });
});

describe("createOutboundBatch's From", () => {
  /* One notice, one building, one sending identity. Stored on the batch rather
   * than the recipient so the worker cannot send half a notice from one
   * address and half from another. */
  it("stores the From on the batch when reside supplies one", async () => {
    const tenant = await makeTenant("f1");
    const batch = await domain.createOutboundBatch({
      tenantId: tenant.id,
      channel: "email",
      subject: "Water shut-off",
      body: "<p>Tuesday</p>",
      recipients: [{ email: "a@example.test" }],
      from: '"One Cardiff Notify" <notify@onecardiff.ca>',
    });

    const stored = await domain.getOutboundBatch(batch.id);
    expect(stored?.fromAddress).toBe('"One Cardiff Notify" <notify@onecardiff.ca>');
  });

  /* Absent keeps the tenant's inbound reply address, which is what every bulk
   * send did before this existed - a caller that does not care must not be
   * silently given a different sender. */
  it("leaves the From null when none is supplied", async () => {
    const tenant = await makeTenant("f2");
    const batch = await domain.createOutboundBatch({
      tenantId: tenant.id,
      channel: "email",
      subject: "Water shut-off",
      body: "<p>Tuesday</p>",
      recipients: [{ email: "a@example.test" }],
    });

    expect((await domain.getOutboundBatch(batch.id))?.fromAddress).toBeNull();
  });
});
