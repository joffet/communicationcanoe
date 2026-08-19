import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "../schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const packageRoot = join(import.meta.dirname, "..", "..");

/**
 * A real Postgres for tests, in-process.
 *
 * This replaces fake-supabase-client, which could not do the one job the tests
 * most need doing. Tenant isolation in this codebase is entirely
 * application-layer - the RLS policies read auth.uid() from Supabase Auth,
 * which the app stopped supplying when it adopted Better Auth, and the
 * connection bypasses RLS regardless - so every `WHERE tenant_id = $1` in a
 * service method IS the security boundary. An in-memory fake matching on
 * JavaScript objects cannot demonstrate that a WHERE clause reached the
 * database, which is exactly the assertion worth making. A cross-tenant read
 * bug survived months in the batch status endpoint for that reason.
 *
 * Schema comes from the same files that build production - the generated
 * migration and the hand-written functions - rather than a copy maintained
 * alongside it. A test schema that drifts from the real one tests nothing.
 */
export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = await PGlite.create({ extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");

  // drizzle-kit separates statements with this marker rather than bare
  // semicolons, which matters because several statements contain semicolons
  // inside quoted defaults and function bodies.
  const migrationsDir = join(packageRoot, "drizzle");
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of migrations) {
    const body = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of body.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  // Functions and triggers are not drizzle-kit's, and must follow the tables
  // they reference. exec() handles the $$-quoted bodies as one script.
  await client.exec(readFileSync(join(packageRoot, "sql", "99-functions-and-triggers.sql"), "utf8"));

  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, close: () => client.close() };
}

/**
 * Empties every table between tests without rebuilding the database - a fresh
 * PGlite instance per test costs about a second, which is enough to discourage
 * writing the tests worth having.
 *
 * TRUNCATE ... CASCADE rather than per-table DELETE so the 53 foreign keys do
 * not dictate an ordering that has to be maintained by hand as tables are
 * added.
 */
export async function resetTestDb(db: TestDb): Promise<void> {
  const tables = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'
  `);
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}
