import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "./client";
import { identityContactHash, identityContactHashSql } from "./anonymize";
import { createTestDb, type TestDb } from "./testing/pglite";
import { identities, tenants } from "./schema";
import { asResideClientUid } from "@communication-canoe/shared/brands";
import { eq } from "drizzle-orm";

// The same vectors are asserted in reside (lib/commCanoe/contactHash.test.ts).
// If either side's normalizer or hash changes, both tests must change together
// or reside's anonymization requests stop matching anything here.
const VECTORS = [
  {
    raw: "  Alice.Smith@Example.COM ",
    normalized: "alice.smith@example.com",
    hash: "7dcd3a39ad3a8d2145645ec612ed4f6fa3f297b47bdcf7e0aeb76040f5e24e89",
    normalize: normalizeEmail,
  },
  {
    raw: "(416) 555-1111",
    normalized: "+14165551111",
    hash: "75c6e08265f22336f39843a10a9e9f089ff8e184836bf44140e8df380bdac7d1",
    normalize: normalizePhone,
  },
];

describe("identityContactHash", () => {
  it.each(VECTORS)("hashes $raw to the shared vector", ({ raw, normalized, hash, normalize }) => {
    expect(normalize(raw)).toBe(normalized);
    expect(identityContactHash(normalized)).toBe(hash);
  });
});

describe("identityContactHashSql", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  }, 60_000);
  afterAll(async () => {
    await close();
  });

  it("computes the same hash in Postgres as in Node", async () => {
    const [tenant] = await db.insert(tenants).values({
      name: "Tenant", twilioNumber: "+15550000001", inboundEmailAddress: "t@example.test",
      chatWidgetKey: "key", resideClientUid: asResideClientUid("client"),
    }).returning();
    const [identity] = await db.insert(identities).values({
      tenantId: tenant.id, email: VECTORS[0].normalized, phone: VECTORS[1].normalized,
    }).returning();

    const [row] = await db
      .select({ email: identityContactHashSql(identities.email), phone: identityContactHashSql(identities.phone) })
      .from(identities)
      .where(eq(identities.id, identity.id));
    expect(row).toEqual({ email: VECTORS[0].hash, phone: VECTORS[1].hash });
  });
});
