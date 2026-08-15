-- Idempotency for reside-originated sends.
--
-- reside is adding a durable retry queue: when a send to comm-canoe fails, it
-- is persisted and retried by a cron rather than silently dropped. That is only
-- safe if retrying is idempotent - on a timeout reside genuinely cannot tell
-- "comm-canoe never got it" from "comm-canoe sent it and the response was
-- lost", so a naive retry would deliver the message to the resident twice.
--
-- reside generates a stable key before its FIRST attempt and reuses it for
-- every retry of that same logical message. The send endpoint returns the
-- existing message when the key is already present instead of sending again.
--
-- Nullable: only reside-originated sends carry a key. Inbound webhooks, chat
-- sessions and workers append messages without one, and many such rows can
-- coexist - hence a partial unique index rather than a plain UNIQUE column
-- (which in Postgres would allow multiple NULLs but is clearer stated this way).

ALTER TABLE messages ADD COLUMN idempotency_key TEXT;

-- Scoped per tenant so two tenants can never collide on a key, and partial so
-- the vast majority of rows (no key) cost nothing to index.
CREATE UNIQUE INDEX messages_tenant_idempotency_key_unique
  ON messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
