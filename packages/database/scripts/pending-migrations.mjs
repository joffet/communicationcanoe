/**
 * Which migrations the migrator would apply, given the ledger's watermark.
 *
 * Separate from check-migrations.mjs so it can be tested without a database:
 * that script connects and calls process.exit at the top level, so importing
 * it to reach this function would run the whole check.
 *
 * This mirrors drizzle-orm's own rule exactly (node-postgres/migrator, via
 * pg-core/dialect). It does not compare counts and it does not compare hashes:
 * it reads the largest `created_at` in drizzle."__drizzle_migrations" and
 * applies every migration whose journal `when` is strictly greater.
 *
 *     const lastDbMigration = dbMigrations[0];   // order by created_at desc limit 1
 *     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * @param {Array<{ tag: string, when: number }>} entries `_journal.json` entries.
 * @param {number | null} watermark Largest `created_at`, or null for an empty ledger.
 * @returns {Array<{ tag: string, when: number }>} The pending entries, journal order.
 */
export function pendingAgainst(entries, watermark) {
  return entries.filter((entry) => watermark === null || watermark < entry.when);
}
