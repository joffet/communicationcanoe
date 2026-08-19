import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside both apps, so nothing loads env for it: Next.js
// reads apps/web/.env.local itself at runtime, and the bridge does its own.
// Without this, MIGRATION_DATABASE_URL is simply undefined here and drizzle-kit
// reports a connection error rather than a missing variable.
//
// apps/web/.env.local first because that is where this project already keeps
// its Postgres credentials; the repo root is the conventional spot and is
// checked as a fallback. Neither overrides a variable already in the
// environment, so CI and Railway keep winning over anything on disk.
for (const path of ["../../apps/web/.env.local", "../../.env"]) {
  loadEnv({ path: new URL(path, import.meta.url).pathname, override: false });
}

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
    // Migrations connect as a different, more privileged role than the app.
    // comm_canoe_app deliberately owns nothing and holds no CREATE on the
    // schema - that is what stops a leaked application credential from
    // dropping a table - so it cannot run DDL, and DATABASE_URL is the wrong
    // credential here by design rather than by oversight.
    //
    // Falling back to DATABASE_URL keeps a local throwaway database working
    // with one variable set, where the app and migration roles are usually the
    // same. Against anything shared, set MIGRATION_DATABASE_URL: without it
    // drizzle-kit will connect as the app role and fail on the first CREATE
    // TABLE, which reads as a schema problem rather than a permissions one.
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
