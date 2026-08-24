import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { tenants } from "../schema";
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

async function makeTenant(suffix = "1") {
  const [tenant] = await db.insert(tenants).values({
    name: `Tenant ${suffix}`,
    twilioNumber: `+1555000000${suffix}`,
    inboundEmailAddress: `${suffix}@example.test`,
    chatWidgetKey: `key-${suffix}`,
    resideClientUid: asResideClientUid(`client-${suffix}`),
  }).returning();
  return tenant;
}


/** mergeIdentities and getCanonicalIdentity are private - reached the same way
 * the merge-extras tests reach moveConversationExtras, rather than widening the
 * public surface for a test's benefit. */
type PrivateIdentityApi = {
  mergeIdentities: (t: string, keep: string, merge: string, on: "email" | "phone") => Promise<void>;
  getCanonicalIdentity: (id: string) => Promise<{ id: string }>;
  findIdentityByEmail: (t: string, email: string) => Promise<{ id: string } | null>;
};
const priv = () => domain as unknown as PrivateIdentityApi;

describe("findOrCreateIdentity", () => {
  it("reuses an existing identity matched on email rather than creating a second", async () => {
    const tenant = await makeTenant();

    const first = await domain.findOrCreateIdentity(tenant.id, { email: "a@example.test" });
    const second = await domain.findOrCreateIdentity(tenant.id, { email: "a@example.test" });

    expect(second.id).toBe(first.id);
  });

  it("keeps identities separate across tenants for the same contact", async () => {
    const one = await makeTenant("1");
    const two = await makeTenant("2");

    const a = await domain.findOrCreateIdentity(one.id, { email: "shared@example.test" });
    const b = await domain.findOrCreateIdentity(two.id, { email: "shared@example.test" });

    // Identity is per-tenant by design: the same person contacting two brands
    // is two identities, and matching across them would leak one tenant's
    // customer into another's inbox.
    expect(b.id).not.toBe(a.id);
  });

  it("fills in a missing field on an existing identity rather than duplicating it", async () => {
    const tenant = await makeTenant();
    const created = await domain.findOrCreateIdentity(tenant.id, { email: "a@example.test" });

    const enriched = await domain.findOrCreateIdentity(tenant.id, {
      email: "a@example.test",
      name: "A Person",
      resideResidentId: "33333333-3333-3333-3333-333333333333",
    });

    expect(enriched.id).toBe(created.id);
    expect(enriched.name).toBe("A Person");
    // reside_resident_id is a uuid column, so the value has to be one - a
    // plain slug is rejected by the type rather than stored and ignored.
    expect(enriched.resideResidentId).toBe("33333333-3333-3333-3333-333333333333");
  });
});

describe("mergeIdentities and getCanonicalIdentity", () => {
  it("resolves a merged identity to the one it was merged into", async () => {
    const tenant = await makeTenant();
    const keep = await domain.findOrCreateIdentity(tenant.id, { email: "keep@example.test" });
    const merge = await domain.findOrCreateIdentity(tenant.id, { phone: "+15551230000" });

    await priv().mergeIdentities(tenant.id, keep.id, merge.id, "email");

    const canonical = await priv().getCanonicalIdentity(merge.id);
    expect(canonical.id).toBe(keep.id);
  });

  it("follows a chain more than one merge deep", async () => {
    const tenant = await makeTenant();
    const a = await domain.findOrCreateIdentity(tenant.id, { email: "a@example.test" });
    const b = await domain.findOrCreateIdentity(tenant.id, { email: "b@example.test" });
    const c = await domain.findOrCreateIdentity(tenant.id, { email: "c@example.test" });

    // c -> b -> a. Resolving c has to walk both hops, not just the first.
    await priv().mergeIdentities(tenant.id, b.id, c.id, "email");
    await priv().mergeIdentities(tenant.id, a.id, b.id, "email");

    expect((await priv().getCanonicalIdentity(c.id)).id).toBe(a.id);
  });

  it("stops matching a merged identity by its contact details", async () => {
    const tenant = await makeTenant();
    const keep = await domain.findOrCreateIdentity(tenant.id, { email: "keep@example.test" });
    const merge = await domain.findOrCreateIdentity(tenant.id, { email: "gone@example.test" });

    await priv().mergeIdentities(tenant.id, keep.id, merge.id, "email");

    // findIdentityByEmail excludes merged rows, so the same address now
    // creates fresh rather than resurrecting a row nothing points at.
    expect(await priv().findIdentityByEmail(tenant.id, "gone@example.test")).toBeNull();
  });
});

describe("findOrCreateAnonymousIdentity", () => {
  it("creates an anonymous identity with no contact details", async () => {
    const tenant = await makeTenant();

    const identity = await domain.findOrCreateAnonymousIdentity(tenant.id, {});

    expect(identity.isAnonymous).toBe(true);
    expect(identity.email).toBeNull();
    expect(identity.phone).toBeNull();
  });

  it("converts an anonymous identity to a named one, clearing the flag", async () => {
    const tenant = await makeTenant();
    const anon = await domain.findOrCreateAnonymousIdentity(tenant.id, {});

    const converted = await domain.convertIdentity(anon.id, tenant.id, {
      email: "now@example.test", name: "Now Named",
    });

    expect(converted.id).toBe(anon.id);
    expect(converted.isAnonymous).toBe(false);
    expect(converted.email).toBe("now@example.test");
  });
});

describe("findOrCreateIdentity under the unique indexes", () => {
  /**
   * The merge branch writes the merged-away row's email onto the survivor
   * while the merged row keeps its own copy - and identities_tenant_email_unique
   * is partial on `email is not null`, not on "canonical", so both rows are in
   * it and the second write violates it.
   *
   * Reachable whenever a contact arrives carrying a phone that matches one
   * identity and an email that matches a different one, which is the ordinary
   * shape for somebody who has texted the building and also emailed it.
   */
  it("survives a contact whose phone and email match two different identities", async () => {
    const tenant = await makeTenant("m");

    // Texted the building: phone only.
    await domain.findOrCreateIdentity(tenant.id, { phone: "+15550000001" });
    // Emailed the building: email only.
    await domain.findOrCreateIdentity(tenant.id, { email: "same@example.test" });

    // Now reside sends them a notice carrying both - the merge branch.
    const merged = await domain.findOrCreateIdentity(tenant.id, {
      phone: "+15550000001",
      email: "same@example.test",
    });

    expect(merged.phone).toBe("+15550000001");
    expect(merged.email).toBe("same@example.test");

    // And it stays resolvable afterwards.
    const again = await domain.findOrCreateIdentity(tenant.id, { email: "same@example.test" });
    expect(again.id).toBe(merged.id);
  });

  /**
   * Two sends for the same person landing at once - which is what
   * parallelising the outbound batch worker produces. Both find nothing, both
   * insert, and the unique index means one of them loses.
   *
   * The index is doing its job: the data cannot be corrupted. The question is
   * whether the loser crashes or reads back the winner's row.
   */
  it("returns the winner's identity when two creates race", async () => {
    const tenant = await makeTenant("r");

    const [a, b] = await Promise.all([
      domain.findOrCreateIdentity(tenant.id, { email: "race@example.test" }),
      domain.findOrCreateIdentity(tenant.id, { email: "race@example.test" }),
    ]);

    expect(a.id).toBe(b.id);
  });
});
