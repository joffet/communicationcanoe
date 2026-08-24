# Realtime bridge (Railway service #2 — voice + web chat)

Persistent WebSocket service bridging Twilio Media Streams and embeddable chat widgets to OpenAI Realtime.

## Endpoints

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `GET /health` | HTTP | Health check |
| `GET /widget.js` | HTTP | Embeddable chat widget bundle |
| `WS /chat` | WebSocket | Chat widget sessions (text-only Realtime) |
| `WS /stream` | WebSocket | Twilio Media Stream (speech-to-speech) |
| `WS /dashboard` | WebSocket | Dashboard live updates + presence (token-authenticated) |
| `POST /internal/handoff-join` | HTTP | Agent joins live chat (internal secret) |
| `POST /internal/agent-message` | HTTP | Relay agent message to visitor WS |
| `POST /internal/broadcast` | HTTP | Conversation change from another process (internal secret) |

## Environment

```bash
REALTIME_BRIDGE_PORT=3001
OPENAI_API_KEY=
DATABASE_URL=
INTERNAL_API_SECRET=
CHAT_HANDOFF_TIMEOUT_MS=90000
CHAT_SESSION_TTL_MS=604800000
NEXT_PUBLIC_APP_URL=http://localhost:3000
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
```

`VOICE_BRIDGE_PORT` is accepted as a backward-compatible alias for `REALTIME_BRIDGE_PORT`.

`DATABASE_URL` is the PlanetScale connection every Postgres read here goes
through. All seven polling workers in `src/workers/` hit it on each tick, and
the service logs which host and database it resolved to at boot.

`INTERNAL_API_SECRET` does double duty: it guards the `/internal/*` endpoints
and it verifies the tokens dashboard sockets present on `/dashboard`, which the
web app mints from a Better Auth session. Both sides must carry the same value
or the inbox goes quiet — it falls back to refetching on navigation, with no
error the user sees.

## Dashboard sockets

`/dashboard` is where the inbox hears that something changed. A client sends
`{type:"auth"}` with its token, then `{type:"watch"}` naming the conversation
it has open; the bridge checks that conversation belongs to the token's tenant
once, at watch time, and everything after that is addressed by conversation id.
Watching also makes the agent a viewer, which is what the presence avatars in
the inbox render. Registry and fan-out live in `src/realtime/dashboard-hub.ts`,
in memory — the same single-instance assumption `sessionManager` already
makes.

## Development

```bash
pnpm --filter @communication-canoe/chat-widget build:copy
pnpm --filter @communication-canoe/realtime-bridge dev
```
