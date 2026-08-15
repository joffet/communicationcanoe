-- Same multi-replica hazard as the outbound-batch worker, one step milder.
--
-- The voicemail worker selects messages with transcription_status 'pending'
-- and only writes a result after transcribing. Its original comment reasoned
-- that re-transcribing is harmless - true for correctness on a single replica,
-- but with two replicas every voicemail gets transcribed twice, doubling the
-- OpenAI spend and racing two writes onto the same message.
--
-- 'transcribing' lets a replica claim a message atomically before doing the
-- expensive work, matching the outbound-batch and scheduled-message workers.

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_transcription_status_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_transcription_status_check
  CHECK (transcription_status = ANY (ARRAY['pending'::text, 'transcribing'::text, 'ready'::text, 'failed'::text]));
