-- Per-client "View and reply" links in resident emails.
--
-- withMemberPortalLink builds that link from a single global RESIDE_APP_URL env
-- var, so every client's residents are pointed at the same reside host
-- regardless of which building they belong to. reside already models this
-- correctly per client (ResideClient.routingDomain, resolved by
-- clientProductionBaseUrl) - comm-canoe just had nowhere to put it.
--
-- Stored as a full URL rather than a bare domain on purpose: reside owns the
-- normalization (strip scheme, drop path/port, prepend https) in
-- clientProductionBaseUrl, and duplicating those rules here would be a second
-- place to get them subtly wrong. comm-canoe just concatenates a path.
--
-- Nullable: tenants provisioned before this, or clients with no routingDomain
-- set, fall back to the RESIDE_APP_URL env var exactly as before.

ALTER TABLE tenants ADD COLUMN reside_app_url TEXT;
