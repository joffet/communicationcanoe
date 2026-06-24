# Communication Canoe

Multi-tenant customer enquiry platform for voice, SMS, email, and embeddable web chat — built as a pnpm monorepo with Next.js 16, Better Auth, Supabase Postgres, and Tailwind CSS.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, data model, and build order.

## Structure

```text
apps/web              Next.js dashboard, webhooks, AI routes, Better Auth
apps/realtime-bridge  Realtime bridge — Twilio Media Streams + chat widget WS
packages/chat-widget  Embeddable chat widget (built to realtime-bridge/public)
packages/database     Supabase clients and domain services
packages/shared       Zod schemas, email parsers, AI tasks, Realtime protocol
supabase/             Migrations, RLS backstop, seed data
```

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable`)
- Hosted [Supabase](https://supabase.com) project (Postgres + Realtime) **or** local Supabase via Docker

## Quick Start (Hosted Supabase)

```bash
pnpm install
cp .env.example apps/web/.env.local
# Fill in: Supabase URL/keys, DATABASE_URL, BETTER_AUTH_SECRET

# Link and push app migrations
pnpm exec supabase login
pnpm exec supabase link --project-ref YOUR_PROJECT_REF
pnpm exec supabase db push

# Create Better Auth tables (user, session, account, verification)
pnpm --filter @communication-canoe/web auth:migrate

# Optional: seed sample tenants/conversations
pnpm exec supabase db query --linked --file supabase/seed.sql

pnpm dev
```

**Better Auth and RLS:** Better Auth creates `"user"`, `"session"`, `"account"`, and `"verification"` in the exposed `public` schema (emails, session tokens, passwords). Run `supabase db push` **before** `auth:migrate` on a fresh project so the RLS migration and auto-RLS event trigger are in place first; new Better Auth tables then get RLS automatically. If you already ran `auth:migrate`, run `supabase db push` to lock down existing auth tables. Better Auth itself uses `DATABASE_URL` (postgres role), not the anon key — RLS only blocks PostgREST/API access.

- Web app: http://localhost:3000
- Realtime bridge health: http://localhost:3001/health
- Chat widget script: http://localhost:3001/widget.js

Generate `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Get `DATABASE_URL` from Supabase Dashboard → **Connect** → ORMs / URI (use the **pooler** connection string on port 6543 for serverless/Railway).

## Auth and Tenant Access

Auth runs via **Better Auth** (magic link only) inside the Next.js app — not Supabase Auth. Outbound email uses **Amazon SES**.

1. Sign in at `/login` — enter your email and open the magic link (creates Better Auth user + `public.users` on first sign-in).
2. Grant tenant access in **SQL Editor** (replace `YOUR_USER_ID` with the Better Auth user id):

```sql
INSERT INTO user_tenant_memberships (user_id, tenant_id, role)
VALUES ('YOUR_USER_ID', '11111111-1111-1111-1111-111111111111', 'admin');
```

3. Open `/inbox`.

Magic links send from `info@communicationcanoe.com` by default. Tenant-scoped outbound email uses each tenant's `inbound_email_address` when available (must be verified in SES).

**Tenant isolation** is enforced in application code: every dashboard/API route verifies session + `user_tenant_memberships` before querying with an explicit `tenant_id`. Postgres RLS remains as a future backstop.

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
| `pnpm exec supabase db push` | Push Supabase migrations to hosted project (run before `auth:migrate` on fresh setups) |
| `pnpm --filter @communication-canoe/web auth:migrate` | Create/update Better Auth tables (uses `--yes`; requires `DATABASE_URL`) |

## Deployment Notes

- **Railway:** deploy `apps/web` and `apps/realtime-bridge` as separate services.
- **Supabase:** Postgres + Realtime only; no Supabase Auth required.
- Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to your production URL.

## Out of Scope (This Milestone)

RLS backstop via session variables, async voicemail.
