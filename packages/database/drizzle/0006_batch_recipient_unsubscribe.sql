-- Per-recipient unsubscribe, for reside's Notices (joffet/reside#496).
--
-- A bulk send takes ONE body for every recipient, which is the whole reason
-- the bulk API exists - so a link naming the person reading it could not
-- reach a notice at all. The body is already stored per recipient, so the URL
-- is substituted into it at enqueue; this column exists so the worker can
-- also put the RFC 8058 header on that recipient's own message, which is not
-- part of the body and cannot be substituted into one.
--
-- Nullable with no backfill: every existing recipient row predates this and
-- carries no unsubscribe link, and null is the "send without the header" the
-- worker already does for one.

ALTER TABLE "outbound_batch_recipients" ADD COLUMN "unsubscribe_url" text;
