-- Decouple reside's client identifier from comm-canoe's tenant primary key.
--
-- The original integration assumed tenants.id IS reside's resideClientUid, so no
-- mapping was needed. That holds only while every reside client uid happens to be
-- a UUID. reside's real production client uid is the slug 'cardiff', which cannot
-- be stored in a UUID primary key at all - so that client could never be
-- provisioned here, and all of its email/SMS silently failed.
--
-- tenants.id stays an internal UUID (every tenant_id FK across the schema keeps
-- pointing at it, unchanged). reside's own identifier moves to its own text
-- column, which is the value reside sends inbound and expects back outbound.

ALTER TABLE tenants ADD COLUMN reside_client_uid TEXT;

-- Backfill: every existing tenant was provisioned under the old assumption, so
-- its reside uid is exactly its current id.
UPDATE tenants SET reside_client_uid = id::text WHERE reside_client_uid IS NULL;

ALTER TABLE tenants ALTER COLUMN reside_client_uid SET NOT NULL;

ALTER TABLE tenants ADD CONSTRAINT tenants_reside_client_uid_unique UNIQUE (reside_client_uid);

-- Inbound lookups resolve by this column on every reside-facing request.
CREATE INDEX tenants_reside_client_uid_idx ON tenants (reside_client_uid);
