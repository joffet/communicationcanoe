-- Lets the app role SEE which migrations have been applied, and nothing else.
--
-- db:check (packages/database/scripts/check-migrations.mjs) runs as a
-- pre-deploy step and refuses a deploy whose migrations have not been applied.
-- It runs as whichever role DATABASE_URL names, because the alternative -
-- putting the postgres role in the running service's environment - is exactly
-- what the app/migration split in drizzle.config.ts exists to prevent.
--
-- comm_canoe_app cannot read the drizzle schema by default: `permission denied
-- for schema drizzle`. This grants the minimum that lets it count rows in one
-- table. It confers no DDL, no write, and no access to anything else in that
-- schema, so the reason the roles are split is untouched.
--
-- Run once per database, as the postgres role, AFTER
-- 00-bootstrap-database-and-role.sql. Until it has run, db:check fails closed
-- and blocks deploys - which is the intended direction for a guard, but means
-- this file is a prerequisite rather than an optional extra.

GRANT USAGE ON SCHEMA drizzle TO comm_canoe_app;
GRANT SELECT ON drizzle."__drizzle_migrations" TO comm_canoe_app;
