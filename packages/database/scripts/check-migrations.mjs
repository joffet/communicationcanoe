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
 * see drizzle.config.ts. Reading the ledger is a read, so this runs as the app
 * role and moves no credential anywhere.
 *
 * Fails closed. A check that cannot tell is worse than no check, because it
 * reads as protection: if the query errors - no access to the drizzle schema,
 * no database - this exits non-zero and says so rather than waving the deploy
 * through.
 *
 * It asks the question the migrator asks. drizzle-orm does not compare counts
 * and does not compare hashes; it reads ONE number - the largest `created_at`
 * in the ledger - and applies every migration on disk whose journal `when` is
 * greater than it:
 *
 *     const lastDbMigration = dbMigrations[0];   // order by created_at desc limit 1
 *     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * Counting rows instead was wrong in both directions, and this database shows
 * why. Its ledger carries a row matching no file in the repo - a locally
 * generated migration that was applied and then discarded - so the count read
 * `8 of 7` and the check had exactly one migration of slack: the next
 * migration added would have made expected 8 and applied 8, and the guard
 * would have passed while that migration sat unapplied. That is precisely the
 * outage it exists to prevent.
 *
 * Comparing against the watermark also catches the renumber-after-apply trap,
 * where an already-applied migration is given a later `when`: the migrator
 * will try to re-run it and fail on the objects it already created, blocking
 * every migration behind it. A count cannot see that at all; the watermark
 * reports it as pending, which is the honest answer.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { pendingAgainst } from "./pending-migrations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const journalPath = join(HERE, "..", "drizzle", "meta", "_journal.json");

function fail(message) {
  console.error(`\n[check-migrations] ${message}\n`);
  process.exit(1);
}

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) fail("Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.");

const journal = JSON.parse(readFileSync(journalPath, "utf8"));

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
} catch (error) {
  fail(`Could not connect to check for pending migrations: ${error.message}`);
}

let watermark;
try {
  const { rows } = await client.query(
    'select max(created_at)::bigint as watermark from drizzle."__drizzle_migrations"'
  );
  // Null on an empty ledger - nothing has ever been applied, so everything is
  // pending. Number() because pg returns bigint as a string.
  watermark = rows[0].watermark === null ? null : Number(rows[0].watermark);
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

const pending = pendingAgainst(journal.entries, watermark);

if (pending.length > 0) {
  fail(
    `${pending.length} migration(s) have not been applied:\n` +
      pending.map((entry) => `    ${entry.tag}`).join("\n") +
      `\n  Deploying now would put this code ahead of its own schema.\n` +
      `  Apply them first, from a checkout with the postgres-role credential:\n` +
      `    MIGRATION_DATABASE_URL=... pnpm db:migrate`
  );
}

console.log(
  `[check-migrations] all ${journal.entries.length} migration(s) applied - schema is up to date.`
);
