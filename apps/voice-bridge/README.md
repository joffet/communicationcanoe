# Voice Bridge (Placeholder)

Future Railway service #2 for real-time voice:

- Twilio Media Stream WebSocket server
- OpenAI Realtime API session per active call
- `transfer_to_human` tool → on-call lookup → Twilio `<Dial>`
- Posts transcript/summary to Next.js internal API on call end

## Endpoints (planned)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Smoke test (implemented) |
| `WS /stream` | Twilio Media Stream bridge (not yet) |

## Local dev

```bash
pnpm dev
curl http://localhost:3001/health
```

## Environment (future)

- `PORT` — default 3001
- `OPENAI_API_KEY`
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`
- `INTERNAL_API_SECRET` — auth to Next.js internal routes
- `NEXT_PUBLIC_APP_URL` — Next.js base URL for callbacks
