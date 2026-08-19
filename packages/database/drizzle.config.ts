import { defineConfig } from "drizzle-kit";

/**
 * comm-canoe owns the `comm_canoe` schema on a shared PlanetScale cluster;
 * reside gets its own alongside it. The two products are loosely coupled -
 * they join on reside's client uid rather than a cross-schema foreign key -
 * so neither schema's migrations ever touch the other's tables.
 *
 * `schemaFilter` is what keeps that true mechanically: without it, drizzle-kit
 * diffs every schema the connection can see and will happily generate DROP
 * statements for tables it doesn't know about, which here would be the other
 * product's.
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
  schemaFilter: ["comm_canoe"],
  tablesFilter: ["!user", "!session", "!account", "!verification"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
