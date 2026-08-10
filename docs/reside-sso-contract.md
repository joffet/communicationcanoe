# reside → comm-canoe SSO token contract

This is the handoff spec for the (separate, later) reside-side project that will issue these
tokens. comm-canoe's side is already implemented against this contract; nothing here should
change without updating `apps/web/src/lib/auth/reside-sso.ts` in lockstep.

## Token shape

A compact, HMAC-signed string, not a JWT (matches the existing `chat-session.ts` pattern in
this codebase):

```
base64url(JSON(claims)) + "." + base64url(HMAC_SHA256(RESIDE_SSO_SIGNING_SECRET, base64url(JSON(claims))))
```

`RESIDE_SSO_SIGNING_SECRET` is a symmetric secret shared out-of-band between reside and
comm-canoe (env var on both sides). A future version may swap this for JWT/RS256 signed with a
key pair reside controls — the verifier is isolated behind `verifyResideSsoToken()` specifically
so that swap doesn't touch call sites.

## Claims

| field | type | required | notes |
|---|---|---|---|
| `externalUserId` | string | yes | reside's stable user id. comm-canoe stores this as `user.resideUserId` and uses it as the identity key — the *only* field used to find/create the local user. |
| `email` | string | yes | used to populate the local user on first sign-in only; not re-synced on later sign-ins. |
| `name` | string | yes | same as `email` — first-sign-in only. |
| `resideClientUid` | string (uuid) | yes | must equal a comm-canoe `tenants.id` (comm-canoe tenants are provisioned with `id = resideClientUid`, see `POST /api/internal/reside/tenants`). The user is granted/updated membership on this tenant. |
| `role` | `"admin" \| "user" \| "super"` | no, default `"user"` | maps to comm-canoe's `tenant_role`: `admin`/`super` → `"admin"`, `user` → `"member"`. |
| `iat` | number (ms epoch) | yes | issued-at, informational. |
| `exp` | number (ms epoch) | yes | expiry — **milliseconds since epoch**, not seconds (matches this codebase's existing token convention, not JWT's). Recommend a short TTL, ≤5 minutes, since this token is single-use (exchanged for a session immediately). |

## Endpoint

```
POST /api/auth/reside-sso
Content-Type: application/json

{ "token": "<the compact token above>" }
```

Mounted through better-auth's catch-all route so it participates in session/cookie handling.

- **200**: sets the better-auth session cookie, returns `{ "user": {...}, "redirectTo": "/inbox" }`.
- **401**: token missing, malformed, signature invalid, or expired.

## Behavior on comm-canoe's side

1. Verify the token (signature + expiry).
2. Look up an existing `user` by `resideUserId = claims.externalUserId`.
3. If none exists, create one (`email`, `name`, `emailVerified: true`, `resideUserId`,
   `resideClientUid`). Existing users are *not* re-synced from later tokens — email/name
   changes in reside won't propagate automatically today.
4. Upsert (not replace) the `user_tenant_memberships` row for `(user, resideClientUid)` with the
   mapped role — this only touches that one membership, so a staff member's access to other
   tenants (if any) is preserved.
5. Create a session and set the cookie.

## Open items for the reside-side implementation

- How the token reaches the browser: a redirect to `GET /sso/reside?token=...` or a same-site
  POST from a reside-hosted intermediate page are both acceptable — comm-canoe's page at
  `apps/web/src/app/(auth)/sso/reside/page.tsx` reads a `token` query param and POSTs it, so
  either works as long as the token ends up as that query param or is POSTed directly to
  `/api/auth/reside-sso`.
- Token is single-use in intent (short TTL) but comm-canoe does not currently track/reject
  replay within the TTL window — acceptable given it only ever mints a session, but worth
  revisiting if this becomes a wider trust boundary.
