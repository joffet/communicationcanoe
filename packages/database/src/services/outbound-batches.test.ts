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
