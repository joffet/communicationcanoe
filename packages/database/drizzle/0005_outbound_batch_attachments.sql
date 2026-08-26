-- Bulk-send attachments (see outboundBatches.attachments): references only,
-- never bytes. Nullable with no backfill - every existing batch predates the
-- column and had nothing to attach, and null is the "no attachments" value
-- the worker already reads for one.

ALTER TABLE "outbound_batches" ADD COLUMN "attachments" jsonb;