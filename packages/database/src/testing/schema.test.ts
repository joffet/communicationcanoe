import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, resetTestDb, type TestDb } from "./pglite";
import { documents, documentChunks, tenants } from "../schema";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);

afterAll(async () => {
  await close();
});

/**
 * Counted against the live PlanetScale database after the first migration
 * applied. If pglite and PlanetScale disagree, either the migration files no
 * longer describe what production runs, or a migration was applied by hand -
 * both worth failing a build over, since the point of this harness is that the
 * schema under test is the schema that ships.
 */
const PRODUCTION_OBJECT_COUNTS = { tables: 23, enums: 14, fks: 53, triggers: 3 };


/** Every NOT NULL column, so a fixture cannot drift from the real table
 * silently. reside_client_uid is required even for a manually-provisioned
 * tenant - 20250701002000 backfilled existing rows with their own id and then
 * set NOT NULL, so there is no such thing as a tenant without one. */
async function makeTenant(suffix: string) {
  const [tenant] = await db.insert(tenants).values({
    name: `Tenant ${suffix}`,
    twilioNumber: `+1555000000${suffix}`,
    inboundEmailAddress: `${suffix}@example.test`,
    chatWidgetKey: `key-${suffix}`,
    resideClientUid: `client-${suffix}`,
  }).returning();
  return tenant;
}

async function makeDocument(tenantId: string) {
  const [doc] = await db.insert(documents).values({
    tenantId, filename: "a.pdf", contentText: "hello", extractor: "test",
  }).returning();
  return doc;
}

describe("schema parity with production", () => {
  it("builds the same objects PlanetScale has", async () => {
    const result = await db.execute<{
      tables: number; enums: number; fks: number; triggers: number;
    }>(sql`
      SELECT
        (SELECT count(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::int AS tables,
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype = 'e')::int AS enums,
        (SELECT count(*) FROM information_schema.table_constraints
          WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY')::int AS fks,
        (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)::int AS triggers
    `);

    expect(result.rows[0]).toEqual(PRODUCTION_OBJECT_COUNTS);
  });

  it("has every function the services call by name", async () => {
    // These are invoked as raw SQL rather than through the query builder, so
    // nothing else would notice if one stopped existing.
    const expected = [
      "assert_chunk_tenant_matches_document",
      "conversation_merge_chain_ids",
      "identity_merge_chain_ids",
      "match_document_chunks",
      "resolve_conversation_id",
      "resolve_identity_id",
      "update_conversation_last_message_at",
      "update_conversation_response_due_at",
    ];

    const result = await db.execute<{ proname: string }>(sql`
      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname = ANY(string_to_array(${expected.join(",")}, ','))
      ORDER BY proname
    `);

    expect(result.rows.map((r) => r.proname)).toEqual(expected);
  });
});

describe("document_chunks tenant guard", () => {
  /**
   * The only tenant guard in this schema that application code cannot skip.
   * Everything else - every service method's WHERE tenant_id - is a convention
   * a future edit can drop silently. This one is a BEFORE INSERT trigger, so
   * it holds regardless of which code path writes the row.
   */
  it("rejects a chunk whose tenant does not match its parent document", async () => {
    await resetTestDb(db);

    const tenantA = await makeTenant("1");
    const tenantB = await makeTenant("2");
    const doc = await makeDocument(tenantA.id);

    // The document belongs to A; the chunk claims B. Nothing in application
    // code has to notice for this to fail.
    //
    // Asserting on .cause rather than the thrown message: drizzle wraps driver
    // errors as "Failed query: ...", so matching the outer message would pass
    // for any failure at all - including the insert being rejected for a
    // reason that has nothing to do with tenancy.
    const attempt = db.insert(documentChunks).values({
      documentId: doc.id, tenantId: tenantB.id, content: "leaked", chunkIndex: 0,
    });

    await expect(attempt).rejects.toThrow();
    await attempt.catch((error: { cause?: { message?: string } }) => {
      expect(error.cause?.message).toMatch(/tenant_id must match parent document/i);
    });
  });

  it("accepts a chunk whose tenant matches", async () => {
    await resetTestDb(db);

    const tenant = await makeTenant("1");
    const doc = await makeDocument(tenant.id);

    const [chunk] = await db.insert(documentChunks).values({
      documentId: doc.id, tenantId: tenant.id, content: "fine", chunkIndex: 0,
    }).returning();

    expect(chunk.tenantId).toBe(tenant.id);
  });
});
