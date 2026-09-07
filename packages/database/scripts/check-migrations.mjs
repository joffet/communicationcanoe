#!/usr/bin/env node
/**
 * Refuses a deploy whose migrations have not been applied.
 *
 * The failure this exists for: merging deploys, and migrations are manual, so
 * code can reach production ahead of its own schema. On 2026-09-07 that put a
 * column into a Drizzle select before the ALTER had run, and the outbound
 * batch worker failed every tick with `column "unsubscribe_url" does not
 * exist` - silently, because a worker has nobody to show an error to.
 *
 * It VERIFIES, it does not apply. Applying would need the postgres role in the
 * running service's environment, and comm_canoe_app deliberately owns nothing
 * and holds no CREATE precisely so a leaked app credential cannot run DDL -
 * see drizzle.config.ts. Counting applied migrations is a read, so this runs
 * as the app role and moves no credential anywhere.
 *
 * Fails closed. A check that cannot tell is worse than no check, because it
 * reads as protection: if the query errors - no access to the drizzle schema,
 * no database - this exits non-zero and says so rather than waving the deploy
 * through.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const journalPath = join(HERE, "..", "drizzle", "meta", "_journal.json");

function fail(message) {
  console.error(`\n[check-migrations] ${message}\n`);
  process.exit(1);
}

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) fail("Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.");

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const expected = journal.entries.length;

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
} catch (error) {
  fail(`Could not connect to check for pending migrations: ${error.message}`);
}

let applied;
try {
  const { rows } = await client.query(
    'select count(*)::int as count from drizzle."__drizzle_migrations"'
  );
  applied = rows[0].count;
} catch (error) {
  // Most likely the app role has no USAGE on the drizzle schema. Say what to
  // grant rather than leaving somebody to work it out during a failed deploy.
  fail(
    `Could not read drizzle."__drizzle_migrations": ${error.message}\n` +
      `  This check runs as whichever role DATABASE_URL names. If that role cannot\n` +
      `  see the drizzle schema, grant it read access once:\n` +
      `    GRANT USAGE ON SCHEMA drizzle TO comm_canoe_app;\n` +
      `    GRANT SELECT ON drizzle."__drizzle_migrations" TO comm_canoe_app;`
  );
} finally {
  await client.end();
}

if (applied < expected) {
  fail(
    `${expected - applied} migration(s) have not been applied ` +
      `(${applied} applied, ${expected} in the journal).\n` +
      `  Deploying now would put this code ahead of its own schema.\n` +
      `  Apply them first, from a checkout with the postgres-role credential:\n` +
      `    MIGRATION_DATABASE_URL=... pnpm db:migrate`
  );
}

console.log(
  `[check-migrations] ${applied} of ${expected} migration(s) applied - schema is up to date.`
);
