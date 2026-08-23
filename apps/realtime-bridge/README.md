# Realtime bridge (Railway service #2 — voice + web chat)

Persistent WebSocket service bridging Twilio Media Streams and embeddable chat widgets to OpenAI Realtime.

## Endpoints

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `GET /health` | HTTP | Health check |
| `GET /widget.js` | HTTP | Embeddable chat widget bundle |
| `WS /chat` | WebSocket | Chat widget sessions (text-only Realtime) |
| `WS /stream` | WebSocket | Twilio Media Stream (speech-to-speech) |
| `POST /internal/handoff-join` | HTTP | Agent joins live chat (internal secret) |
| `POST /internal/agent-message` | HTTP | Relay agent message to visitor WS |

## Environment

```bash
REALTIME_BRIDGE_PORT=3001
OPENAI_API_KEY=
DATABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
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
the service logs which host and database it resolved to at boot. The two
`SUPABASE_*` variables are for Realtime broadcasts only; no query reaches a
database through them.

## Development

```bash
pnpm --filter @communication-canoe/chat-widget build:copy
pnpm --filter @communication-canoe/realtime-bridge dev
```
