# Communication Canoe — Architecture Reference

Multi-tenant service for managing customer enquiries across voice, SMS, and email, with AI-assisted routing, summarization, and a real-time voice agent capable of live transfer to a human.

---

## 1. Core Concepts

- **Tenant** — a brand/business using the platform. Each tenant has its own phone number, email address, customers, teams, and conversations. Data is isolated per tenant.
- **Identity** — an external customer, scoped to a single tenant. Identified by phone and/or email.
- **Conversation** — one per identity, per tenant. All channels (voice, SMS, email) from that person flow into this single thread.
- **Message** — a single inbound or outbound item (a text, an email, a call transcript) within a conversation.
- **Internal user** — staff who reply to conversations. Belongs to one or more tenants via membership, and to teams within a tenant.

---

## 2. Decisions Made So Far

| Area | Decision | Reasoning |
|---|---|---|
| Identity matching | Match by phone OR email, auto-merge when either matches | Best UX; requires reversible merge model with audit trail |
| Identity scope | Per-tenant, never cross-tenant | Same person contacting two different brands = two separate identities |
| Hosting | Railway — single platform for all app services | Simpler ops than splitting Vercel + a separate persistent service; no major benefit from Vercel's edge network for an internal tool |
| Database | Supabase (Postgres) | RLS for tenant/team isolation (as backstop), built-in realtime — kept separate from Railway |
| Voice AI | OpenAI Realtime API (speech-to-speech) | Single-socket conversational AI, native function calling for transfer logic |
| Text AI (routing/FAQ/summarization) | Claude or GPT via standard API calls | Stateless, runs as ordinary API routes — no special infra |
| Telephony | Twilio | Numbers, SMS, voice, `<Dial>` for live transfer |
| Live call transfer | Twilio `<Dial>` to a human's real phone number | Simpler than browser-based pickup; works day one |
| Email | Postmark or SendGrid (inbound parse webhook) | Avoids AWS SES's S3+Lambda requirement for inbound mail |
| Auth | Better Auth (runs inside the Next.js app on Railway) | Decouples auth from Supabase — Supabase's role narrows to Postgres + RLS-as-backstop + realtime; existing team familiarity with Better Auth from other projects; fits the "minimize platforms" rationale behind the Railway-everything decision; active org/SSO plugin support covers multi-tenant and future SSO needs |
| Numbering | One phone number per tenant | Number is the entry point for tenant resolution |
| Internal user scope | Most users belong to one tenant; some need multi-tenant access | Requires a `UserTenantMembership` join table, not a single `tenant_id` on `User` |
| Concurrency (multi-agent replies) | Presence indicator only (who's viewing), no formal ownership lock | Avoids duplicate replies without adding assignment complexity |

---

## 3. System Diagram

```
                         ┌──────────────────────────────┐
                         │           TWILIO              │
                         │  - One number per tenant       │
                         │  - Voice webhook → TwiML        │
                         │    <Connect><Stream>             │
                         │  - SMS webhook → HTTP POST       │
                         │  - <Dial> for live transfer       │
                         └───────────┬───────────┬──────────┘
                  (voice, WS audio)  │           │ (SMS, HTTP webhook)
                                     ▼           ▼
                  ┌────────────────────┐   ┌─────────────────────────┐
                  │  VOICE BRIDGE        │   │   NEXT.JS APP            │
                  │  SERVICE             │   │   (Railway service #1)   │
                  │  (Railway service #2)│   │   - Tenant resolution     │
                  │  - Persistent WS      │   │     by number/address    │
                  │    server             │   │   - SMS/email webhooks    │
                  │  - Bridges Twilio      │   │   - Dashboard/inbox UI    │
                  │    Media Stream ↔      │◄──┤   - Auth (Better Auth)    │
                  │    OpenAI Realtime     │   │   - AI routing/FAQ/        │
                  │  - Queries on-call      │   │     summarization calls   │
                  │    availability         │   │   - REST API for bridge   │
                  │  - Posts transcript/     │   │     (internal network)    │
                  │    summary on call end   │   └───────────┬──────────────┘
                  │  - Triggers <Dial> via    │               │
                  │    Twilio REST API        │               │
                  └────────────┬───────────────┘               │
                               │ (internal network, same Railway project)
                               └───────────────┬───────────────┘
                                               ▼
                              ┌──────────────────────────────────┐
                              │         SUPABASE (Postgres)        │
                              │  - tenants, identities,             │
                              │    conversations, messages           │
                              │  - teams, users, memberships          │
                              │  - RLS scoped by tenant_id (backstop)   │
                              │  - Realtime: live inbox, presence       │
                              │  (Auth lives in Next.js app via          │
                              │   Better Auth, not Supabase)              │
                              └──────────────────────────────────┘
                                               ▲
                                               │ inbound email
                              ┌──────────────────────────────────┐
                              │  POSTMARK / SENDGRID                │
                              │  - One inbound address per tenant     │
                              │  - Inbound parse webhook → Next.js     │
                              └──────────────────────────────────┘
```

**Why two Railway services instead of one:** the Next.js app is stateless request/response and can scale normally. The voice bridge holds a long-lived WebSocket per active call (Twilio Media Stream ↔ OpenAI Realtime) and needs to run as a persistent process — it's kept as a separate service so it can be scaled, restarted, or debugged independently of the main app, while still living in the same Railway project for simple internal networking and one shared billing/ops surface.

---

## 4. Multi-Tenancy Model

Every request, regardless of channel, resolves a tenant **first**, before anything else happens:

- **Voice/SMS:** the Twilio number dialed/texted identifies the tenant.
- **Email:** the inbound address (e.g. `support@brandA.com`) identifies the tenant.

Once tenant is resolved, all downstream work — identity matching, conversation lookup/creation, team routing, AI calls — happens strictly within that tenant's scope.

**Hard rules:**

- Identity matching (phone/email auto-merge) never crosses tenant boundaries.
- Every core table carries `tenant_id`.
- **Enforcement is application-layer first, RLS as backstop.** Because auth (Better Auth) is decoupled from Supabase, tenant scoping is not free the way it would be with Supabase Auth's native JWT-to-RLS integration. Every API route/query must explicitly filter by `tenant_id` derived from the verified Better Auth session — never rely on implicit context. RLS policies scoped by `tenant_id` should still be set up in Postgres as a second line of defense (passing the authenticated `tenant_id` into Postgres via a session variable), but the primary guarantee comes from disciplined application-layer filtering, not the database alone.
- Internal users access tenants via a membership table, not a single foreign key, since some staff need multi-tenant access (e.g. an agency managing several brands).

---

## 5. Data Model (Entities)

```
Tenant
  id, name, twilio_number, inbound_email_address, created_at

Identity
  id, tenant_id, phone (nullable), email (nullable), name (nullable),
  merged_into_id (nullable, self-ref)

IdentityMergeLog
  id, tenant_id, identity_a_id, identity_b_id, matched_on (phone|email),
  merged_at, merged_by (system|user_id), unmerged_at (nullable)

Conversation
  id, tenant_id, identity_id, status (open|pending|resolved),
  assigned_team_id (nullable), assigned_user_id (nullable),
  summary (nullable), created_at, last_message_at

Message
  id, tenant_id, conversation_id, channel (voice|sms|email),
  direction (inbound|outbound), sender_type (external|internal_user|ai_agent),
  sender_id (nullable), body, audio_url (nullable), transcript (nullable),
  ai_summary (nullable), created_at

Team
  id, tenant_id, name

TeamMembership
  user_id, team_id, role, is_on_call (boolean)

User
  id, name, email, phone_number, available_for_calls (boolean)
  -- auth identity/session managed by Better Auth; this table holds
  -- the app-domain profile and is linked to Better Auth's user record

UserTenantMembership
  user_id, tenant_id, role

CallTransfer
  id, tenant_id, conversation_id, message_id,
  attempted_user_id, outcome (answered|no_answer|declined), created_at
```

**Notes:**

- `merged_into_id` is non-destructive — auto-merge points one identity at another rather than collapsing rows, so unmerge is just clearing the pointer, and merge history stays auditable via `IdentityMergeLog`.
- One `Conversation` per identity holds the full multi-channel thread; routing (`assigned_team_id`/`assigned_user_id`) happens within that single conversation rather than splitting threads per team.
- `CallTransfer` is logged independently of `Message` — it's the record of *attempts*, including failures, which matters for staffing/coverage analysis later (e.g. missed after-hours transfer rate).
- Live "who's viewing this conversation" presence is ephemeral (Supabase Realtime presence/broadcast) and does not need to be persisted to a table.

---

## 6. Real-Time Voice Flow (with Live Transfer)

```
1. Caller dials tenant's Twilio number
2. Twilio webhook → Next.js resolves tenant → returns TwiML
   <Connect><Stream> pointing at the voice bridge service
3. Bridge opens an OpenAI Realtime session for this call
   - Streams caller audio in, agent audio out
   - Agent has a `transfer_to_human` tool available
4. Caller requests a human, or the agent determines escalation is needed
5. Agent calls transfer_to_human(reason, conversation_id)
6. Bridge:
   a. Queries Supabase (internal network call) for on-call,
      available users for the relevant team within this tenant
   b. Plays a short "connecting you now" message
   c. Calls Twilio's REST API to <Dial> the chosen user's phone number,
      bridging them into the live call
   d. Logs the attempt to CallTransfer
7a. Human answers → live with caller → CallTransfer.outcome = answered
7b. No answer → fallback TwiML brings the AI agent back on the line to
    take a message → CallTransfer.outcome = no_answer
8. On call end (either path): bridge POSTs transcript, summary, and
   recording URL to Next.js's internal API → stored as a Message on
   the existing Conversation
```

**Open implementation detail to resolve before building this part:** the no-answer fallback path needs to be modeled as a TwiML fallback action on the `<Dial>`, not handled as an afterthought — a failed dial with no fallback simply drops the caller.

---

## 7. AI Responsibilities (Text Side)

Separate from the real-time voice agent — these are ordinary stateless API calls.

| Task | Trigger | Behavior |
|---|---|---|
| Routing | New conversation, or new message in an unassigned conversation | Classify against the tenant's team list → set `assigned_team_id` |
| FAQ suggestion | Internal user opens a conversation | Retrieve similar resolved conversations/FAQ content → suggest a draft reply (never auto-sent) |
| Summarization | Conversation goes idle, on demand, or after a voice call ends | Summarize the thread → store in `Conversation.summary` and/or `Message.ai_summary` |

---

## 8. Suggested Build Order

1. **Data model + Supabase setup** — tenants, identities, conversations, messages, teams, users, memberships. Wire up Better Auth in the Next.js app, enforce `tenant_id` scoping in every query at the application layer, and add RLS policies as a backstop. Get this right first.
2. **SMS path end-to-end** — Twilio SMS webhook → tenant resolution → identity match/create → conversation → basic inbox UI. Simplest channel; validates the core model.
3. **Email path** — inbound parse webhook → same conversation model. Validates phone/email merge logic for real.
4. **Text AI features** — routing, summarization, FAQ suggestions. Pure API-route work.
5. **Async voice (voicemail-to-text)** — Twilio records, transcribes, drops into conversation as a message. No real-time bridge yet.
6. **Real-time voice agent + bridge service** — hardest piece, built once the conversation/identity/tenant model is proven.
7. **Live transfer** — on-call lookup, `<Dial>` logic, fallback handling, `CallTransfer` logging.

---

## 9. Open Questions / Not Yet Decided

- Full Postgres schema in SQL (columns, types, indexes, constraints) — sketched above as entities only.
- API contract between Next.js and the bridge service (request/response shapes, internal auth between the two Railway services).
- Exact mechanism for passing `tenant_id`/`user_id` from a Better Auth session into Postgres RLS as a backstop (e.g. `SET LOCAL` per request vs. a custom claim read by policy functions) — needed once RLS-as-backstop is implemented, not a blocker for initial build.
- Whether tenant branding/config (greeting message, business hours, FAQ content) lives in its own `TenantSettings` table or as JSON config on `Tenant`.
- Rate limiting / abuse handling for inbound channels (e.g. spam SMS, robocall floods hitting the voice agent).
- Whether `CallTransfer` no-answer fallback should retry a second on-call user before giving up, or go straight to voicemail-style message-taking.
