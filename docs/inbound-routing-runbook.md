# Inbound routing: texts, calls and email into the inbox

How a resident's text, call or email reaches a tenant's comm-canoe inbox, what
has to be configured outside this repo for it to work, and how to prove it
does. Written for One Cardiff (reside client `cardiff`), which is the first
tenant wired end to end; every step applies to the next building the same way.

## Where each channel lands

| Channel | Provider points at | Then |
|---|---|---|
| SMS | Twilio number `sms_url` → reside `https://<building domain>/api/sms/inbound` | reside handles STOP/START (SMS opt-outs) and forwards every other text to comm-canoe `POST /api/internal/reside/inbound/sms` (`x-reside-secret`) |
| Voice | Twilio number `voice_url` → `https://api.communicationcanoe.com/api/webhooks/twilio/voice` | voicemail: `recording-status` stores the recording, the realtime-bridge worker transcribes it |
| Email | building MX (forwardemail.net for onecardiff.ca) → alias forwards to the Postmark inbound address | Postmark → `POST /api/webhooks/postmark/inbound` |

SMS goes through reside rather than straight to comm-canoe because reside owns
the opt-out keywords and already verifies the Twilio signature with the
*tenant's own* auth token (reside supports a Twilio account per client;
comm-canoe only knows the global `TWILIO_AUTH_TOKEN`). One signature check,
one owner for STOP/START, and no Twilio change for SMS.

## Why Cardiff's inbound was dark (2026-09-27)

- **SMS**: the number pointed at reside's `/api/sms/inbound`, which handled
  STOP/START and dropped everything else with an empty TwiML ack. Fixed in
  code: reside forwards (joffet/reside#907), comm-canoe accepts the forward.
- **Voice**: `voice_url` was also reside's SMS route, which answers every call
  with empty TwiML. Needs a Twilio change (below).
- **Email**: `info@onecardiff.ca` is handled by forwardemail.net and does not
  forward to Postmark; comm-canoe never saw a request. Needs a forwardemail
  change and a webhook secret (below).

## Production changes — each needs the owner's explicit OK before it is made

Deploy order: comm-canoe first (the new endpoint must exist before reside
calls it), then reside. Until both are live nothing changes for residents.

### 1. SMS — no Twilio change required

- Railway (`comm-canoe-web`) and reside's host must already share
  `RESIDE_API_SECRET`, and reside must have `COMM_CANOE_API_BASE`
  (both already used by reside's outbound sends; confirm by name only).
- **Recommended, needs OK:** change the number's `sms_url` from
  `http://onecardiff.ca/api/sms/inbound` to
  `https://onecardiff.ca/api/sms/inbound` (POST). Twilio Monitor has 11200
  (HTTP 405) alerts on the `http://` URL from 2026-09-23 — consistent with an
  http→https redirect turning the POST into a GET. reside derives the signed
  URL from the request, so https validates without any other change.

### 2. Voice — Twilio number `voice_url`

Before changing it, confirm (read-only):

1. `NEXT_PUBLIC_APP_URL` on `comm-canoe-web` is exactly
   `https://api.communicationcanoe.com` — https, no trailing slash, no path.
   The voice, recording-status and dial-status routes validate the Twilio
   signature against `${NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/<route>`,
   so any difference from the URL configured in Twilio is a 403 on every call.
2. The number's `AccountSid` (IncomingPhoneNumbers API) is the account whose
   token is `comm-canoe-web`'s `TWILIO_AUTH_TOKEN`. If Cardiff's number lives
   in a sub-account or its own account (reside's `ResideClient.twilioAuthToken`),
   comm-canoe cannot validate its signatures and calls will 403 — stop and
   decide before switching.

Change: `voice_url = https://api.communicationcanoe.com/api/webhooks/twilio/voice`,
method POST. Leave `voice_fallback_url` empty or point it at the same URL.
Rollback: set `voice_url` back to its previous value.

### 3. Email — webhook secret, Postmark, forwardemail.net

1. **Railway variable** (`comm-canoe-web`): set
   `POSTMARK_INBOUND_WEBHOOK_SECRET` to a fresh random value
   (`openssl rand -hex 32`). As of this change the route **fails closed**: with
   the variable unset every inbound email is refused (403). Nothing was
   arriving before, so no tenant loses mail by this.
2. **Postmark** (the comm-canoe server → Inbound stream → Settings): set the
   inbound webhook URL to
   `https://postmark:<secret>@api.communicationcanoe.com/api/webhooks/postmark/inbound`.
   Postmark sends the credentials as HTTP basic auth; the route checks the
   password. Note the stream's inbound address (`<hash>@inbound.postmarkapp.com`).
3. **forwardemail.net** (owner, in the onecardiff.ca domain dashboard — the
   alias is not in DNS): open the `info` alias and **add** the Postmark
   inbound address as a recipient, **keeping** every existing recipient, so
   whoever reads info@ today still gets every message. Do not replace.

How the tenant is found: forwardemail rewrites only the SMTP envelope, so the
message Postmark parses still carries `To: info@onecardiff.ca`. The route tries
each To, then Cc, then Bcc address against `tenants.inbound_email_address` and
takes the first match — a resident who writes to the building second in To or
in Cc still lands in Cardiff's inbox. Mail whose headers name none of them
(e.g. info@ only in the resident's Bcc) gets a 404 and is not ingested; it
still reaches info@'s human recipients through forwardemail.

## Verifying end to end

For each channel, once its change is live, with the owner's OK for each test
send, from the owner's own phone/email only:

1. Send one test message (SMS: text the Twilio number; voice: call and leave a
   short voicemail; email: write to info@onecardiff.ca).
2. Railway → `comm-canoe-web` → HTTP logs, exact-path filter:
   - SMS: `@path:/api/internal/reside/inbound/sms` → one `200`
   - Voice: `@path:/api/webhooks/twilio/voice` → `200`, then
     `@path:/api/webhooks/twilio/recording-status` → `200`
   - Email: `@path:/api/webhooks/postmark/inbound` → `200`
3. The message appears as a conversation in https://onecardiff.ca/admin/inbox.
4. For SMS, also text `STOP` then `START` from the same phone: reside must
   still answer with its confirmation text, and neither keyword may appear
   in the inbox or in the Railway log for the forward endpoint.

Failure signatures:

| Symptom | Likely cause |
|---|---|
| forward endpoint `401` | `RESIDE_API_SECRET` differs between reside and comm-canoe |
| forward endpoint `409` | `tenants.twilio_number` is not the number reside matched |
| no request at all, reside log `forwarding … failed` | `COMM_CANOE_API_BASE` wrong/unset on reside, or comm-canoe down |
| voice `403` | `NEXT_PUBLIC_APP_URL` mismatch or the number is in another Twilio account |
| postmark `403` | secret unset on Railway or not in the Postmark URL |
| postmark `404` | no To/Cc/Bcc address equals `tenants.inbound_email_address` |

Once SMS works, the original check: text "How does my visitor get into the
parking garage?" and use Suggest reply on the new conversation. The draft
should mention the north side entry panel, dialling the resident's code, and
pressing 9 — details that exist only in the "Website FAQ" knowledge document.

## Known gaps, not fixed here

- **A failed SMS forward is not retried later.** reside tries twice within
  Twilio's 15s window, then logs and acks Twilio (a non-200 risks Twilio
  disabling the webhook, and Twilio does not retry SMS webhooks anyway). A
  comm-canoe outage longer than that loses the texts sent during it. A durable
  inbound queue in reside (the outbox is outbound-only) would close this.
- **MMS media** is not carried — the direct Twilio handler never did either.
- reside's SMS status callback `https://onecardiff.ca/api/sms/status` returned
  15003 (HTTP 403) on 2026-09-23 — a separate signature/URL mismatch in reside.
- Suggest reply answers building-wide notices instead of the resident: a
  notice sent to many residents becomes the newest message in each of their
  conversations.
- Suggest reply fails with a blank error on a conversation flooded with
  copied plate-violation notices.
