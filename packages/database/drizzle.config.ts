import { defineConfig } from "drizzle-kit";

/**
 * comm-canoe owns its own logical database on a shared PlanetScale cluster;
 * reside gets a separate one alongside it. Isolation is by database rather
 * than schema, so this connection cannot see reside's tables at all and
 * drizzle-kit has no way to propose dropping them.
 *
 * The better-auth tables are deliberately absent from the Drizzle schema -
 * `better-auth migrate` owns them - so they are excluded from the diff too.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // Must match db.ts's runtime client. drizzle-kit writes the column names
  // into the migration SQL and the runtime client queries by them, so if the
  // two disagree about casing the DDL and the ORM silently describe different
  // columns. The schema names every column explicitly as well, which makes
  // this a safety net rather than the only thing holding it together.
  casing: "snake_case",
  tablesFilter: ["!user", "!session", "!account", "!verification"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
