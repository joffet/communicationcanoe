import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads apps/realtime-bridge/.env.local when it is present.
 *
 * Unlike the web app, nothing loads this for us: Next.js reads .env.local on
 * its own, but the bridge boots through `tsx`/`node`, which do not. Without
 * this the process starts and serves /health perfectly happily while every
 * worker that touches Postgres throws "Missing DATABASE_URL" on each tick -
 * a failure that only shows up in the log, never in the health check.
 *
 * The work happens at module scope, not in an exported function: ES module
 * imports are hoisted, so a call placed between imports in index.ts would
 * still run after every one of them had been evaluated. Importing this module
 * first is what makes it land before anything reads process.env.
 *
 * Real environment variables win over the file (Node's documented precedence),
 * so hosted deploys that inject their own config are unaffected, and the file
 * is optional there - hence the existsSync guard rather than a hard read.
 *
 * Resolved relative to this module so it works both from src/ under tsx and
 * from dist/ after a build; both sit one level below the package root.
 */
const path = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(path)) process.loadEnvFile(path);
