# Hand-written SQL

These are **not** drizzle-kit migrations and are deliberately outside
`drizzle/`. That folder is generated: drizzle-kit tracks its contents in
`meta/_journal.json` and applies only what the journal lists, so a hand-written
file sitting there is never run by `db:migrate` — it just looks like it will be.
Worse, both of these once used `0000_`/`0001_` prefixes that collided with
drizzle-kit's own numbering.

Run order:

1. **`00-bootstrap-database-and-role.sql`** — once per cluster, before any
   drizzle-kit migration. It creates the logical database that everything else
   lives in, so it cannot be a migration *within* that database. `CREATE
   DATABASE` also cannot run inside a transaction block, which rules out
   drizzle-kit applying it regardless.

2. `pnpm db:migrate` — drizzle-kit's generated migrations, the tables
   themselves.

3. **`99-functions-and-triggers.sql`** — after the tables exist, since every
   statement in it references a table by name. Re-runnable: everything is
   `CREATE OR REPLACE`, except the triggers, which need dropping first if their
   definition changes.

Both files run as the durable `postgres` role, not `comm_canoe_app` — the app
role owns nothing and holds no CREATE, which is what stops a leaked application
credential from dropping a table.

`pscale sql` is the simplest way to run them without a local psql:

```
pscale sql reside-platform main --org <org> --role admin --dbname comm_canoe \
  --format json --query "<statement>"
```
