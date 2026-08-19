import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

let pool: Pool | undefined;

/**
 * One pool per process, reused across requests.
 *
 * Both services that use this run as long-lived processes on Railway rather
 * than per-request functions, so a module-level pool is the right shape - the
 * connection cost is paid once at boot instead of on every query. That is also
 * why this does not reach for a serverless HTTP driver: there is no cold-start
 * or connection-storm problem to solve here.
 */
function getPool(): Pool {
  if (pool) return pool;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL");

  pool = new Pool({
    connectionString: url,
    // PlanetScale terminates TLS but does not present a cert chain that Node's
    // default CA bundle validates, so verification has to be relaxed here.
    // Encryption still applies; only chain verification is skipped.
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return pool;
}

export function createDb() {
  return drizzle(getPool(), { schema, casing: "snake_case" });
}

/** Closes the pool. For test teardown and graceful shutdown only. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
