# Communication Canoe — Architecture Reference

Multi-tenant service for managing customer enquiries across voice, SMS, email, and embeddable web chat, with AI-assisted routing, summarization, and a real-time conversational AI capable of live transfer to a human on both voice calls and chats.

---

## 1. Core Concepts

- **Tenant** — a brand/business using the platform. Each tenant has its own phone number, email address, embeddable chat widget, customers, teams, and conversations. Data is isolated per tenant.
- **Identity** — an external customer, scoped to a single tenant. Identified by phone and/or email, or may be anonymous (web chat visitor with no contact info yet).
- **Conversation** — one per identity, per tenant. All channels (voice, SMS, email, web chat) from that person flow into this single thread.
- **Message** — a single inbound or outbound item (a text, an email, a call transcript, a chat message) within a conversation.
- **Internal user** — staff who reply to conversations. Belongs to one or more tenants via membership, and to teams within a tenant.

---

## 2. Decisions Made So Far

| Area                                | Decision                                                                                                                      | Reasoning                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity matching                   | Match by phone OR email, auto-merge when either matches                                                                       | Best UX; requires reversible merge model with audit trail                                                                                                                                                                                                                                                               |
| Identity scope                      | Per-tenant, never cross-tenant                                                                                                | Same person contacting two different brands = two separate identities                                                                                                                                                                                                                                                   |
| Hosting                             | Railway — single platform for all app services                                                                                | Simpler ops than splitting Vercel + a separate persistent service; no major benefit from Vercel's edge network for an internal tool                                                                                                                                                                                     |
| Database                            | Supabase (Postgres)                                                                                                           | RLS for tenant/team isolation (as backstop), built-in realtime — kept separate from Railway                                                                                                                                                                                                                             |
| Voice AI                            | OpenAI Realtime API (speech-to-speech)                                                                                        | Single-socket conversational AI, native function calling for transfer logic                                                                                                                                                                                                                                             |
| Text AI (routing/FAQ/summarization) | Claude or GPT via standard API calls                                                                                          | Stateless, runs as ordinary API routes — no special infra                                                                                                                                                                                                                                                               |
| Telephony                           | Twilio                                                                                                                        | Numbers, SMS, voice, `<Dial>` for live transfer                                                                                                                                                                                                                                                                         |
| Live call transfer                  | Twilio `<Dial>` to a human's real phone number                                                                                | Simpler than browser-based pickup; works day one                                                                                                                                                                                                                                                                        |
| Email                               | Postmark or SendGrid (inbound parse webhook)                                                                                  | Avoids AWS SES's S3+Lambda requirement for inbound mail                                                                                                                                                                                                                                                                 |
| Auth                                | Better Auth (runs inside the Next.js app on Railway)                                                                          | Decouples auth from Supabase — Supabase's role narrows to Postgres + RLS-as-backstop + realtime; existing team familiarity with Better Auth from other projects; fits the "minimize platforms" rationale behind the Railway-everything decision; active org/SSO plugin support covers multi-tenant and future SSO needs |
| Numbering                           | One phone number per tenant                                                                                                   | Number is the entry point for tenant resolution                                                                                                                                                                                                                                                                         |
| Internal user scope                 | Most users belong to one tenant; some need multi-tenant access                                                                | Requires a `UserTenantMembership` join table, not a single `tenant_id` on `User`                                                                                                                                                                                                                                        |
| Concurrency (multi-agent replies)   | Presence indicator only (who's viewing), no formal ownership lock                                                             | Avoids duplicate replies without adding assignment complexity                                                                                                                                                                                                                                                           |
| Web chat identity                   | Ask for name/email upfront but allow anonymous start; AI re-prompts later in-conversation; anon identity convertible to named | Matches real visitor behavior — most won't fill a form before chatting, but you still want a path to capture contact info                                                                                                                                                                                               |
| Web chat AI engine                  | OpenAI Realtime API, text-only mode — same session infra as voice                                                             | Shares the AI's reasoning/personality/tools and the transfer-to-human pattern across voice and chat rather than maintaining two separate AI implementations                                                                                                                                                             |
| Web chat transport                  | Browser WebSocket, hosted on the existing bridge service                                                                      | Bidirectional, low-latency, reuses a WS server that already exists rather than introducing SSE/long-polling as a second transport pattern                                                                                                                                                                               |
| Web chat live transfer              | Human joins via the same dashboard inbox UI, gets a live indicator, types directly into the conversation                      | No separate "takeover" view needed; the inbox becomes the live interface when a chat needs a human                                                                                                                                                                                                                      |

---

## 3. System Diagram

```
                         ┌──────────────────────────────┐         ┌────────────────────────────┐
                         │           TWILIO              │         │   EMBEDDABLE CHAT WIDGET    │
                         │  - One number per tenant       │         │  (on tenant's website)       │
                         │  - Voice webhook → TwiML        │         │  - Browser WebSocket          │
                         │    <Connect><Stream>             │         │  - Asks name/email upfront,    │
                         │  - SMS webhook → HTTP POST       │         │    allows anonymous start       │
                         │  - <Dial> for live transfer       │         └─────────────┬──────────────┘
                         └───────────┬───────────┬──────────┘                       │ (WS)
                  (voice, WS audio)  │           │ (SMS, HTTP webhook)              │
                                     ▼           ▼                                  ▼
                  ┌─────────────────────────┐   ┌─────────────────────────┐
                  │  REALTIME BRIDGE          │   │   NEXT.JS APP            │
                  │  SERVICE                  │   │   (Railway service #1)   │
                  │  (Railway service #2)      │   │   - Tenant resolution     │
                  │  - Persistent WS server,    │   │     by number/address/    │
                  │    handles both:             │   │     widget key             │
                  │    1) Twilio Media Streams    │   │   - SMS/email webhooks      │
                  │    2) Chat widget WS sessions  │   │   - Dashboard/inbox UI      │
                  │  - Bridges both to OpenAI       │◄──┤   - Auth (Better Auth)      │
                  │    Realtime (voice mode or       │   │   - AI routing/FAQ/          │
                  │    text-only mode per session)    │   │     summarization calls       │
                  │  - Queries on-call availability     │   │   - REST API for bridge       │
                  │  - Posts transcript/summary on       │   │     (internal network)         │
                  │    call/chat end                      │   └───────────┬────────────────────┘
                  │  - Voice: triggers <Dial> via            │               │
                  │    Twilio REST API                        │               │
                  │  - Chat: marks conversation as              │               │
                  │    "needs human", notifies dashboard          │               │
                  │    via Supabase Realtime                        │               │
                  └────────────┬─────────────────────────────────────┘               │
                               │ (internal network, same Railway project)             │
                               └───────────────────────────────────┬───────────────────┘
                                                                   ▼
                              ┌──────────────────────────────────┐
                              │         SUPABASE (Postgres)        │
                              │  - tenants, identities,             │
                              │    conversations, messages           │
                              │  - teams, users, memberships          │
                              │  - RLS scoped by tenant_id (backstop)   │
                              │  - Realtime: live inbox, presence,        │
                              │    live-chat-needs-human notifications     │
                              │  (Auth lives in Next.js app via             │
                              │   Better Auth, not Supabase)                 │
                              └──────────────────────────────────┘
                                               ▲
                                               │ inbound email
                              ┌──────────────────────────────────┐
                              │  POSTMARK / SENDGRID                │
                              │  - One inbound address per tenant     │
                              │  - Inbound parse webhook → Next.js     │
                              └──────────────────────────────────┘
```

**Why the bridge service now handles two jobs:** both voice and chat need a persistent, stateful connection to OpenAI's Realtime API — voice in speech-to-speech mode, chat in text-only mode. Rather than standing up a second persistent service, the existing bridge is extended to also terminate browser WebSocket connections from the chat widget. This keeps "things that need a long-lived connection" consolidated in one place, and lets both channels share the same AI session-handling logic, function/tool definitions (including `transfer_to_human`), and transcript-persistence code path.

---

## 4. Multi-Tenancy Model

Every request, regardless of channel, resolves a tenant **first**, before anything else happens:

- **Voice/SMS:** the Twilio number dialed/texted identifies the tenant.
- **Email:** the inbound address (e.g. `support@brandA.com`) identifies the tenant.
- **Web chat:** the widget is initialized with a tenant-specific public key (embedded in the script tag the tenant adds to their site), which the bridge service validates on WS connection to resolve the tenant before any message is processed.

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
  id, name, twilio_number, inbound_email_address, chat_widget_key, created_at

Identity
  id, tenant_id, phone (nullable), email (nullable), name (nullable),
  is_anonymous (boolean), merged_into_id (nullable, self-ref)

IdentityMergeLog
  id, tenant_id, identity_a_id, identity_b_id, matched_on (phone|email),
  merged_at, merged_by (system|user_id), unmerged_at (nullable)

IdentityConversionLog
  id, tenant_id, identity_id, converted_at, converted_by (system|user_id),
  captured_name (nullable), captured_email (nullable), captured_phone (nullable)

Conversation
  id, tenant_id, identity_id, status (open|pending|resolved),
  assigned_team_id (nullable), assigned_user_id (nullable),
  summary (nullable), created_at, last_message_at

Message
  id, tenant_id, conversation_id, channel (voice|sms|email|web_chat),
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

LiveTransfer
  id, tenant_id, conversation_id, message_id, channel (voice|web_chat),
  attempted_user_id, outcome (answered|no_answer|declined), created_at
```

**Notes:**

- `merged_into_id` is non-destructive — auto-merge points one identity at another rather than collapsing rows, so unmerge is just clearing the pointer, and merge history stays auditable via `IdentityMergeLog`.
- `is_anonymous` lets a web chat `Identity` exist with no phone and no email. Converting an anonymous identity to a named one (visitor eventually gives a name/email) is logged via `IdentityConversionLog` rather than just overwriting fields, so there's a record of when/how contact info was captured.
- One `Conversation` per identity holds the full multi-channel thread; routing (`assigned_team_id`/`assigned_user_id`) happens within that single conversation rather than splitting threads per team.
- `LiveTransfer` (renamed from a voice-only `CallTransfer`) is logged independently of `Message` and now covers both voice and web chat handoffs to a human — it's the record of _attempts_, including failures, which matters for staffing/coverage analysis later (e.g. missed after-hours transfer rate, across both channels).
- Live "who's viewing this conversation" presence is ephemeral (Supabase Realtime presence/broadcast) and does not need to be persisted to a table. The same presence mechanism is used to show "live chat needs a human" in the dashboard.

---

## 6. Real-Time Voice Flow (with live transfer)

```
1. Caller dials tenant's Twilio number
2. Twilio webhook → Next.js resolves tenant → returns TwiML
   <Connect><Stream> pointing at the bridge service
3. Bridge opens an OpenAI Realtime session (voice mode) for this call
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
   d. Logs the attempt to LiveTransfer (channel = voice)
7a. Human answers → live with caller → LiveTransfer.outcome = answered
7b. No answer → fallback TwiML brings the AI agent back on the line to
    take a message → LiveTransfer.outcome = no_answer
8. On call end (either path): bridge POSTs transcript, summary, and
   recording URL to Next.js's internal API → stored as a Message on
   the existing Conversation
```

**Open implementation detail to resolve before building this part:** the no-answer fallback path needs to be modeled as a TwiML fallback action on the `<Dial>`, not handled as an afterthought — a failed dial with no fallback simply drops the caller.

---

## 6b. Real-Time Web Chat Flow (with live transfer)

```
1. Visitor loads the tenant's website; the embedded widget script
   connects via WebSocket to the bridge service, presenting the
   tenant's chat_widget_key
2. Bridge validates the key → resolves tenant → widget asks for
   name/email upfront, but lets the visitor skip and start anonymously
3. Bridge creates (or resumes) an Identity:
   - Named, if name/email given
   - Anonymous (is_anonymous = true), if skipped
   ...and creates/finds the Conversation for that identity
4. Bridge opens an OpenAI Realtime session (text-only mode) for
   this chat — same tool definitions as voice, including
   `transfer_to_human`, plus a `capture_contact_info` tool the AI
   can use to ask again for name/email later in the conversation
5. Each turn (visitor message in, AI message out) is persisted as
   a Message (channel = web_chat) in near-real-time, not just at
   the end — unlike voice, there's no single "end of call" moment
   to batch-write a transcript
6. If `capture_contact_info` succeeds mid-conversation:
   - Identity is updated, is_anonymous set to false
   - Logged to IdentityConversionLog
7. Visitor asks for a human, or the AI determines escalation is needed
8. Agent calls transfer_to_human(reason, conversation_id)
9. Bridge:
   a. Marks the Conversation as "needs human" via Supabase Realtime
      (no phone dial equivalent — this is a presence/notification event)
   b. Tells the visitor "connecting you to a team member"
   c. Logs the attempt to LiveTransfer (channel = web_chat)
10. A human sees the live indicator in the dashboard inbox, joins,
    and types directly into the same conversation - bridge routes
    their messages to the visitor's WS connection in place of the AI
11a. Human responds in time → LiveTransfer.outcome = answered
11b. No one picks up within a timeout → LiveTransfer.outcome = no_answer,
     AI resumes handling the chat and offers to take a message instead
```

**Open implementation details to resolve before building this part:**

- **Reconnection handling.** A plain browser WebSocket will drop on network blips, tab sleep, or page navigation. The widget needs to detect disconnection and resume against the same `Conversation`/session rather than starting a new one — this is the chat equivalent of the voice no-answer fallback and shouldn't be left as an afterthought.
- **No-answer timeout value.** Unlike a phone ring (which has a natural timeout), "no one picked up the chat" needs an explicit timeout chosen deliberately (e.g. 60–90 seconds) before the AI resumes.
- **Mid-conversation handoff mechanics inside the bridge.** When a human joins, the bridge needs to stop forwarding the visitor's messages to the OpenAI Realtime session and start forwarding them to the dashboard (and vice versa for outbound) — this routing switch is new logic, not something voice's `<Dial>` model gives you for free.

---

## 7. AI Responsibilities (Text Side)

Separate from the real-time voice/chat AI — these are ordinary stateless API calls.

| Task           | Trigger                                                                    | Behavior                                                                                      |
| -------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Routing        | New conversation, or new message in an unassigned conversation             | Classify against the tenant's team list → set `assigned_team_id`                              |
| FAQ suggestion | Internal user opens a conversation                                         | Retrieve similar resolved conversations/FAQ content → suggest a draft reply (never auto-sent) |
| Summarization  | Conversation goes idle, on demand, or after a voice call/chat session ends | Summarize the thread → store in `Conversation.summary` and/or `Message.ai_summary`            |

---

## 8. Suggested Build Order

1. **Data model + Supabase setup** — tenants, identities, conversations, messages, teams, users, memberships. Wire up Better Auth in the Next.js app, enforce `tenant_id` scoping in every query at the application layer, and add RLS policies as a backstop. Get this right first.
2. **SMS path end-to-end** — Twilio SMS webhook → tenant resolution → identity match/create → conversation → basic inbox UI. Simplest channel; validates the core model.
3. **Email path** — inbound parse webhook → same conversation model. Validates phone/email merge logic for real.
4. **Text AI features** — routing, summarization, FAQ suggestions. Pure API-route work.
5. **Async voice (voicemail-to-text)** — Twilio records, transcribes, drops into conversation as a message. No real-time bridge yet.
6. **Real-time voice agent + bridge service** — hardest piece, built once the conversation/identity/tenant model is proven.
7. **Live transfer (voice)** — on-call lookup, `<Dial>` logic, fallback handling, `LiveTransfer` logging.
8. **Embeddable web chat widget + chat WS sessions on the bridge** — extend the bridge to handle chat sessions in text-only Realtime mode; reuse the AI tool definitions and transfer pattern already proven by voice.
9. **Live transfer (chat)** — dashboard "needs human" indicator, handoff routing inside the bridge, no-answer timeout/fallback.

---

## 9. Open Questions / Not Yet Decided

- Full Postgres schema in SQL (columns, types, indexes, constraints) — sketched above as entities only.
- API contract between Next.js and the bridge service (request/response shapes, internal auth between the two Railway services).
- Exact mechanism for passing `tenant_id`/`user_id` from a Better Auth session into Postgres RLS as a backstop (e.g. `SET LOCAL` per request vs. a custom claim read by policy functions) — needed once RLS-as-backstop is implemented, not a blocker for initial build.
- Whether tenant branding/config (greeting message, business hours, FAQ content) lives in its own `TenantSettings` table or as JSON config on `Tenant`.
- Rate limiting / abuse handling for inbound channels (e.g. spam SMS, robocall floods hitting the voice agent, or scripted spam connecting to the chat widget).
- Whether `LiveTransfer` no-answer fallback (voice or chat) should retry a second on-call user before giving up, or go straight to voicemail/message-taking.
- Widget reconnection protocol — how a dropped chat WebSocket resumes against the same `Conversation` rather than starting a new one.
- No-answer timeout duration for chat live transfer, and whether it should differ from voice's `<Dial>` ring timeout.
- Whether the embeddable widget needs visual/brand customization per tenant (colors, logo, greeting text) and where that config lives.
