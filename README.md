# Communication Canoe

Multi-tenant customer enquiry platform for voice, SMS, email, and embeddable web chat — built as a pnpm monorepo with Next.js 16, Better Auth, PlanetScale Postgres (Drizzle ORM), and Tailwind CSS. Supabase remains in the stack for Realtime pub/sub only.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, data model, and build order.

## Structure

```text
apps/web              Next.js dashboard, webhooks, AI routes, Better Auth
apps/realtime-bridge  Realtime bridge — Twilio Media Streams + chat widget WS
packages/chat-widget  Embeddable chat widget (built to realtime-bridge/public)
packages/database     Drizzle schema, migrations, and domain services
packages/shared       Zod schemas, email parsers, AI tasks, Realtime protocol
supabase/             Pre-cutover migration history and dev seed — no longer applied
```

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable`)
- [PlanetScale](https://planetscale.com) Postgres database (app data), plus a hosted [Supabase](https://supabase.com) project for Realtime

## Quick Start

```bash
pnpm install
cp .env.example apps/web/.env.local
# Fill in: DATABASE_URL, MIGRATION_DATABASE_URL, Supabase URL/keys, BETTER_AUTH_SECRET

# Once per cluster, as the postgres role — creates the logical database and app
# role. See packages/database/sql/README.md for run order and how to execute it.
#   packages/database/sql/00-bootstrap-database-and-role.sql

# Build the schema
pnpm db:migrate

# Functions and triggers, after the tables exist (also from packages/database/sql)
#   packages/database/sql/99-functions-and-triggers.sql

# Create Better Auth tables (user, session, account, verification)
pnpm --filter @communication-canoe/web auth:migrate

# Optional: seed sample tenants/conversations
psql "$MIGRATION_DATABASE_URL" -f supabase/seed.sql

pnpm dev
```

**Better Auth tables:** Better Auth creates `"user"`, `"session"`, `"account"`, and `"verification"` itself, using `DATABASE_URL`. They are deliberately absent from the Drizzle schema — `better-auth migrate` owns them — and `drizzle.config.ts` excludes them from the diff via `tablesFilter`, so drizzle-kit will never propose dropping them.

- Web app: http://localhost:3000
- Realtime bridge health: http://localhost:3001/health
- Chat widget script: http://localhost:3001/widget.js

Generate `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

`DATABASE_URL` is the app role's PlanetScale connection string (`comm_canoe_app`); `MIGRATION_DATABASE_URL` is the `postgres` role's, used by drizzle-kit only. The app role owns nothing and holds no `CREATE`, so it cannot run DDL by design — see the comments in [drizzle.config.ts](packages/database/drizzle.config.ts). The Supabase URL/keys are for Realtime only.

## Auth and Tenant Access

Auth runs via **Better Auth** (magic link only) inside the Next.js app — not Supabase Auth. Outbound email uses **Amazon SES**.

1. Sign in at `/login` — enter your email and open the magic link (creates Better Auth user + `public.users` on first sign-in).
2. Grant tenant access against the database (replace `YOUR_USER_ID` with the Better Auth user id):

```sql
INSERT INTO user_tenant_memberships (user_id, tenant_id, role)
VALUES ('YOUR_USER_ID', '11111111-1111-1111-1111-111111111111', 'admin');
```

3. Open `/inbox`.

Magic links send from `info@communicationcanoe.com` by default. Tenant-scoped outbound email uses each tenant's `inbound_email_address` when available (must be verified in SES).

**Tenant isolation** is enforced in application code and nowhere else: every dashboard/API route verifies session + `user_tenant_memberships` before querying with an explicit `tenant_id`. There is no RLS backstop — the Supabase policies keyed off `auth.uid()` and were dropped at the cutover rather than ported, so each `WHERE tenant_id = $1` *is* the boundary. [tenant-isolation.test.ts](packages/database/src/services/tenant-isolation.test.ts) is what replaced them; new service methods need a case there.

## Super Admin and Platform Admin

Platform operators use the **`super_admin`** role on `public.users` (`platform_role` column). Super admins can:

- Open `/admin` (dashboard, tenants, users)
- Access any tenant's inbox without explicit membership
- Create tenants, invite users, and manage tenant memberships

**Bootstrap your first super admin** (pick one):

1. **Env var** — add to `apps/web/.env.local` before first login:
   ```bash
   SUPER_ADMIN_EMAILS=you@company.com
   ```
2. **SQL** — after signing in once:
   ```sql
   UPDATE users SET platform_role = 'super_admin' WHERE email = 'you@company.com';
   ```

Admin routes:

| Route | Purpose |
|---|---|
| `/admin` | Dashboard (counts + quick links) |
| `/admin/tenants` | Tenant list with sort, filter, search |
| `/admin/tenants/new` | Create tenant |
| `/admin/tenants/[id]/edit` | Edit tenant |
| `/admin/users` | User list with sort, filter, search |
| `/admin/users/new` | Create user + optional magic-link invite |
| `/admin/users/[id]/edit` | Edit user, super-admin flag, memberships |

When adding a user from admin, the **Send sign-in email** toggle (default on) sends a styled HTML magic-link invite via SES.


### Twilio SMS

- URL: `POST {NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sms`
- Validates `X-Twilio-Signature` when `TWILIO_AUTH_TOKEN` is set.

### Postmark Inbound

- URL: `POST {NEXT_PUBLIC_APP_URL}/api/webhooks/postmark/inbound`

## AI Features

| Feature | Endpoint | Notes |
|---|---|---|
| Routing | Auto on inbound SMS/email | Assigns `assigned_team_id` |
| Summarize | `POST /api/conversations/:id/summarize` | Inbox UI button |
| Suggest reply | `GET /api/conversations/:id/suggest-reply` | Draft only |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start web + realtime-bridge |
| `pnpm build` | Production build |
| `pnpm db:generate` | Generate a migration from changes to `packages/database/src/schema/index.ts` |
| `pnpm db:migrate` | Apply pending Drizzle migrations (uses `MIGRATION_DATABASE_URL`) |
| `pnpm db:studio` | Open Drizzle Studio against the database |
| `pnpm --filter @communication-canoe/web auth:migrate` | Create/update Better Auth tables (uses `--yes`; requires `DATABASE_URL`) |

## Deployment Notes

- **Railway:** deploy `apps/web` and `apps/realtime-bridge` as separate services.
- **PlanetScale:** Postgres for all app data; migrations run with `MIGRATION_DATABASE_URL`, the app with `DATABASE_URL`.
- **Supabase:** Realtime only; no Supabase Postgres or Supabase Auth required.
- Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to your production URL.

## Out of Scope (This Milestone)

Both former entries here are settled. The RLS backstop via session variables
was decided against rather than deferred — see Tenant Isolation above. Async
voicemail shipped: `apps/realtime-bridge/src/workers/voicemail-transcription-worker.ts`
plus the Twilio `voice` and `recording-status` webhooks.
