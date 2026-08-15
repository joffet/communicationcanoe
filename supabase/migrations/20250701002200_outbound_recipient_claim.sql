-- Make the outbound-batch worker safe to run on more than one replica.
--
-- It previously fetched pending recipients and only wrote their status AFTER
-- dispatching, with no claim in between. With a single replica that was fine.
-- With two, both would read the same pending rows and both would send - on a
-- Notice to hundreds of residents, hundreds of duplicate emails.
--
-- Adds the 'sending' state so a recipient can be claimed atomically
-- (pending -> sending) before dispatch, exactly as the scheduled-message
-- worker already claims messages via delivery_status. claimed_at lets a later
-- tick reclaim rows whose claiming replica died mid-send.

ALTER TABLE outbound_batch_recipients
  DROP CONSTRAINT IF EXISTS outbound_batch_recipients_status_check;

ALTER TABLE outbound_batch_recipients
  ADD CONSTRAINT outbound_batch_recipients_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed'));

ALTER TABLE outbound_batch_recipients ADD COLUMN claimed_at TIMESTAMPTZ;

-- Finds rows stuck in 'sending' because their replica died before resolving
-- them. Partial: only claimed rows are ever scanned.
CREATE INDEX outbound_batch_recipients_claimed_idx
  ON outbound_batch_recipients (claimed_at)
  WHERE status = 'sending';
