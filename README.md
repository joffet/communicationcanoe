# Customer Interaction Platform

Multi-tenant customer enquiry platform for voice, SMS, and email — built as a pnpm monorepo with Next.js 16, Supabase, and Tailwind CSS.

## Structure

```text
apps/web           Next.js dashboard, webhooks, AI routes
apps/voice-bridge  Placeholder health service (real-time voice later)
packages/database  Supabase clients and domain services
packages/shared    Zod schemas, email parsers, AI tasks
supabase/          Migrations, RLS, seed data
```

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (via `pnpm exec supabase` or global install)
- Docker (for local Supabase)

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy env and fill in Supabase keys after `supabase start`
cp .env.example apps/web/.env.local

# Start local Supabase (Postgres, Auth, Realtime)
pnpm db:start

# Apply migrations + seed
pnpm db:reset

# Copy keys from `supabase status` into apps/web/.env.local
pnpm exec supabase status

# Start all apps
pnpm dev
```

- Web app: http://localhost:3000
- Voice bridge health: http://localhost:3001/health
- Supabase Studio: http://127.0.0.1:54323

## Auth and Tenant Access

1. Open Supabase Studio → Authentication → create a user (email/password).
2. Note the user's UUID from `auth.users`.
3. Insert a membership (replace `YOUR_USER_ID`):

```sql
INSERT INTO users (id, email, name)
VALUES ('YOUR_USER_ID', 'you@example.com', 'You')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_tenant_memberships (user_id, tenant_id, role)
VALUES ('YOUR_USER_ID', '11111111-1111-1111-1111-111111111111', 'admin');
```

4. Sign in at `/login` and open `/inbox`.

Seed data includes tenant **Acme Support** with a sample SMS conversation (visible via service-role webhook path; inbox requires membership above).

## Webhooks

### Twilio SMS

- URL: `POST {NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sms`
- Configure on your Twilio number's messaging webhook.
- Resolves tenant by `To` number, creates identity/conversation/message.
- Validates `X-Twilio-Signature` when `TWILIO_AUTH_TOKEN` is set.

Local testing with ngrok:

```bash
ngrok http 3000
# Set NEXT_PUBLIC_APP_URL to the ngrok HTTPS URL
```

### Postmark Inbound

- URL: `POST {NEXT_PUBLIC_APP_URL}/api/webhooks/postmark/inbound`
- Set inbound domain address to match tenant `inbound_email_address` (seed: `support@acme.example`).
- Optional: set `POSTMARK_INBOUND_WEBHOOK_SECRET` and send header `X-Postmark-Webhook-Secret`.

## AI Features

| Feature | Endpoint | Notes |
|---|---|---|
| Routing | Auto on inbound SMS/email | Assigns `assigned_team_id` via `/api/ai/route` logic |
| Summarize | `POST /api/conversations/:id/summarize` | Inbox UI button |
| Suggest reply | `GET /api/conversations/:id/suggest-reply` | Draft only, never auto-sent |

Set `AI_PROVIDER=openai` or `anthropic` and the corresponding API key. Without keys, stub responses are returned for local development.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start web + voice-bridge via Turborepo |
| `pnpm build` | Production build |
| `pnpm db:start` | Start local Supabase |
| `pnpm db:reset` | Reset DB, run migrations + seed |
| `pnpm db:types` | Regenerate TypeScript types from local schema |

## Deployment Notes

- **Railway:** deploy `apps/web` and `apps/voice-bridge` as separate services in one project.
- **Supabase:** hosted Postgres/Auth/Realtime separate from Railway.
- Use `SUPABASE_SERVICE_ROLE_KEY` only on the server (webhooks, AI writes after tenant resolution).

## Out of Scope (This Milestone)

Real-time voice bridge, live call transfer, async voicemail, rate limiting, Railway config files.
