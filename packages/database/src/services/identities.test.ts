import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { conversations, identities, identityConversionLogs, messages, outboundBatchRecipients, tenants } from "../schema";
import { identityContactHash } from "../anonymize";
import { eq } from "drizzle-orm";
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
  getCanonicalIdentity: (id: string) => Promise<{ id: string; email: string | null; phone: string | null }>;
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

describe("renameIdentity", () => {
  const RESIDENT_ID = "44444444-4444-4444-4444-444444444444";

  it("renames by resideResidentId when the contact has changed", async () => {
    const tenant = await makeTenant("rn1");
    await domain.findOrCreateIdentity(tenant.id, {
      email: "old@example.test",
      resideResidentId: RESIDENT_ID,
    });

    const outcome = await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "old@example.test", new: "new@example.test" },
    });

    expect(outcome?.result).toBe("renamed");
    expect(outcome?.identity.email).toBe("new@example.test");
  });

  it("falls back to matching the old email when resideResidentId isn't on the row yet", async () => {
    const tenant = await makeTenant("rn2");
    // Predates the reside_resident_id backfill - contact only, no resident id.
    await domain.findOrCreateIdentity(tenant.id, { email: "legacy@example.test" });

    const outcome = await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "legacy@example.test", new: "fresh@example.test" },
    });

    expect(outcome?.result).toBe("renamed");
    expect(outcome?.identity.email).toBe("fresh@example.test");
  });

  it("falls back to matching the old phone when resideResidentId isn't on the row yet", async () => {
    const tenant = await makeTenant("rn3");
    await domain.findOrCreateIdentity(tenant.id, { phone: "+15550001111" });

    const outcome = await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      phone: { old: "+15550001111", new: "+15550002222" },
    });

    expect(outcome?.result).toBe("renamed");
    expect(outcome?.identity.phone).toBe("+15550002222");
  });

  it("returns null when nothing matches by resident id, old email, or old phone", async () => {
    const tenant = await makeTenant("rn4");

    const outcome = await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "nobody@example.test", new: "somebody@example.test" },
    });

    expect(outcome).toBeNull();
  });

  it("is idempotent: re-running with values already on the row makes no change", async () => {
    const tenant = await makeTenant("rn5");
    await domain.findOrCreateIdentity(tenant.id, {
      email: "old@example.test",
      resideResidentId: RESIDENT_ID,
    });
    await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "old@example.test", new: "new@example.test" },
    });

    const again = await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "old@example.test", new: "new@example.test" },
    });

    expect(again?.result).toBe("unchanged");
    expect(again?.identity.email).toBe("new@example.test");
  });

  it("merges into the other identity when the new email already belongs to someone else in the tenant", async () => {
    const tenant = await makeTenant("rn6");
    const moving = await domain.findOrCreateIdentity(tenant.id, {
      email: "moving@example.test",
      resideResidentId: RESIDENT_ID,
    });
    const other = await domain.findOrCreateIdentity(tenant.id, {
      email: "taken@example.test",
      phone: "+15559998888",
    });

    const outcome = await domain.renameIdentity(tenant.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "moving@example.test", new: "taken@example.test" },
    });

    expect(outcome?.result).toBe("merged");
    // The survivor carries the merged row's other contact detail (phone)
    // alongside the resident id and updated email - both histories, one row.
    expect(outcome?.identity.phone).toBe("+15559998888");
    expect(outcome?.identity.email).toBe("taken@example.test");
    expect(outcome?.identity.resideResidentId).toBe(RESIDENT_ID);

    // The merged-away row now resolves to the survivor.
    expect((await priv().getCanonicalIdentity(other.id)).id).toBe(moving.id);
  });

  it("never matches or touches an identity in another tenant", async () => {
    const tenantA = await makeTenant("rnA");
    const tenantB = await makeTenant("rnB");
    const inB = await domain.findOrCreateIdentity(tenantB.id, {
      email: "shared@example.test",
      resideResidentId: RESIDENT_ID,
    });

    // Same resideResidentId AND same old email, but scoped to tenant A -
    // must not find tenant B's row.
    const outcome = await domain.renameIdentity(tenantA.id, {
      resideResidentId: RESIDENT_ID,
      email: { old: "shared@example.test", new: "changed@example.test" },
    });

    expect(outcome).toBeNull();
    const untouched = await priv().getCanonicalIdentity(inB.id);
    expect(untouched.email).toBe("shared@example.test");
  });
});

describe("anonymizeIdentities", () => {
  const RESIDENT = "44444444-4444-4444-8444-444444444444";

  async function seedPerson(tenantId: Parameters<DomainService["findOrCreateIdentity"]>[0]) {
    const identity = await domain.findOrCreateIdentity(tenantId, {
      email: "Ada@Example.test",
      phone: "(416) 555-1111",
      name: "Ada Lovelace",
      resideResidentId: RESIDENT,
    });
    const [conversation] = await db.insert(conversations).values({
      tenantId, identityId: identity.id, status: "open",
    }).returning();
    const message = await domain.appendMessage({
      tenantId, conversationId: conversation.id, channel: "email", direction: "outbound",
      senderType: "system", body: "Your parcel is at the desk",
    });
    await db.update(messages).set({ deliveryError: "550 5.1.1 <ada@example.test>: no such user" })
      .where(eq(messages.id, message.id));
    return { identity, conversation, message };
  }

  const hashOf = (value: string) => identityContactHash(value);

  it("matches by reside resident id and replaces name and contacts with placeholders", async () => {
    const tenant = await makeTenant();
    const { identity } = await seedPerson(tenant.id);

    const count = await domain.anonymizeIdentities(tenant.id, { resideResidentId: RESIDENT, contactHashes: [] });

    expect(count).toBe(1);
    const [row] = await db.select().from(identities).where(eq(identities.id, identity.id));
    expect(row).toMatchObject({
      name: "Deleted resident",
      email: `deleted.${identity.id}@anonymized.invalid`,
      phone: null,
      resideResidentId: null,
      emailConsecutiveFailures: 0,
      phoneConsecutiveFailures: 0,
      emailFlaggedAt: null,
      phoneFlaggedAt: null,
    });
    expect(row.anonymizedAt).toBeInstanceOf(Date);
  });

  it("matches by email hash alone", async () => {
    const tenant = await makeTenant();
    const { identity } = await seedPerson(tenant.id);

    expect(await domain.anonymizeIdentities(tenant.id, { contactHashes: [hashOf("ada@example.test")] })).toBe(1);
    const [row] = await db.select().from(identities).where(eq(identities.id, identity.id));
    expect(row.anonymizedAt).not.toBeNull();
  });

  it("matches by phone hash alone", async () => {
    const tenant = await makeTenant();
    const { identity } = await seedPerson(tenant.id);

    expect(await domain.anonymizeIdentities(tenant.id, { contactHashes: [hashOf("+14165551111")] })).toBe(1);
    const [row] = await db.select().from(identities).where(eq(identities.id, identity.id));
    expect(row.anonymizedAt).not.toBeNull();
  });

  it("ignores a resident id that is not a UUID rather than failing the cast", async () => {
    const tenant = await makeTenant();
    await seedPerson(tenant.id);

    expect(await domain.anonymizeIdentities(tenant.id, { resideResidentId: "cardiff-1301-a", contactHashes: [] })).toBe(0);
  });

  it("scrubs every row of a merge chain, including merged-away rows that kept their contacts", async () => {
    const tenant = await makeTenant();
    const keep = await domain.findOrCreateIdentity(tenant.id, { email: "ada@example.test" });
    const [byPhone] = await db.insert(identities).values({ tenantId: tenant.id, phone: "+14165551111" }).returning();
    const [byWork] = await db.insert(identities).values({ tenantId: tenant.id, email: "ada@work.test" }).returning();
    await priv().mergeIdentities(tenant.id, keep.id, byPhone.id, "phone");
    await priv().mergeIdentities(tenant.id, keep.id, byWork.id, "email");

    // Only the phone is known; the chain carries the rest.
    const count = await domain.anonymizeIdentities(tenant.id, { contactHashes: [hashOf("+14165551111")] });

    expect(count).toBe(3);
    const rows = await db.select().from(identities).where(eq(identities.tenantId, tenant.id));
    for (const row of rows) {
      expect(row.anonymizedAt).not.toBeNull();
      expect(row.phone).toBeNull();
      expect(row.email).toBe(`deleted.${row.id}@anonymized.invalid`);
    }
  });

  it("keeps message bodies and redacts provider errors that quote the address", async () => {
    const tenant = await makeTenant();
    const { message } = await seedPerson(tenant.id);

    await domain.anonymizeIdentities(tenant.id, { resideResidentId: RESIDENT, contactHashes: [] });

    const [row] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(row.body).toBe("Your parcel is at the desk");
    expect(row.deliveryError).toBe("redacted");
  });

  it("clears conversion-log captures and batch recipient contacts, keeping the sent body", async () => {
    const tenant = await makeTenant();
    const anon = await domain.findOrCreateAnonymousIdentity(tenant.id, {});
    await domain.convertIdentity(anon.id, tenant.id, { email: "ada@example.test", name: "Ada" });
    const batch = await domain.createOutboundBatch({
      tenantId: tenant.id, channel: "email", subject: "Water shut-off", body: "Water is off at 10. {{unsubscribe_url}}",
      recipients: [{ email: "ada@example.test", name: "Ada", resideResidentId: RESIDENT, unsubscribeUrl: "https://x.test/u/abc" }],
    });

    await domain.anonymizeIdentities(tenant.id, {
      resideResidentId: RESIDENT, contactHashes: [hashOf("ada@example.test")],
    });

    const [log] = await db.select().from(identityConversionLogs).where(eq(identityConversionLogs.tenantId, tenant.id));
    expect(log).toMatchObject({ capturedName: null, capturedEmail: null, capturedPhone: null });
    const [recipient] = await db.select().from(outboundBatchRecipients).where(eq(outboundBatchRecipients.batchId, batch.id));
    expect(recipient.identityContact).toEqual({ name: "Deleted resident" });
    expect(recipient.unsubscribeUrl).toBeNull();
    expect(recipient.body).toContain("Water is off at 10.");
  });

  it("is idempotent: a second call finds nothing left to do", async () => {
    const tenant = await makeTenant();
    await seedPerson(tenant.id);
    const input = { resideResidentId: RESIDENT, contactHashes: [hashOf("ada@example.test"), hashOf("+14165551111")] };

    expect(await domain.anonymizeIdentities(tenant.id, input)).toBe(1);
    expect(await domain.anonymizeIdentities(tenant.id, input)).toBe(0);
  });

  it("does nothing without a resident id or a hash", async () => {
    const tenant = await makeTenant();
    await seedPerson(tenant.id);
    expect(await domain.anonymizeIdentities(tenant.id, { contactHashes: [] })).toBe(0);
  });

  it("never writes a contact back onto an anonymized row: a new inbound creates a new identity", async () => {
    const tenant = await makeTenant();
    const { identity } = await seedPerson(tenant.id);
    await domain.anonymizeIdentities(tenant.id, { resideResidentId: RESIDENT, contactHashes: [] });

    const fresh = await domain.findOrCreateIdentity(tenant.id, { phone: "+14165551111", name: "Ada again" });

    expect(fresh.id).not.toBe(identity.id);
    const [old] = await db.select().from(identities).where(eq(identities.id, identity.id));
    expect(old.phone).toBeNull();
    expect(old.name).toBe("Deleted resident");
    expect(await domain.findIdentityForContact(tenant.id, { phone: "+14165551111" })).toMatchObject({ id: fresh.id });
  });
});
