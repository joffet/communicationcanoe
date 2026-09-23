-- Return any voicemail stranded at 'transcribing' to 'pending' so the worker
-- picks it up again.
--
-- Data only, no schema change, and it very probably updates ZERO rows today -
-- 0007_long_punisher established that no message has ever carried a
-- transcription_status at all, which is why that poll got no index. This is
-- the cleanup for a bug that has never had the chance to fire, not a recovery
-- from one that has: it exists so the first tenant to record a voicemail after
-- the fix does not inherit whatever the window between this and the deploy
-- left behind.
--
-- The bug it cleans up after: 20250701002300 added 'transcribing' as a claim
-- state and 3a49882 taught the worker to claim into it, but left both terminal
-- writes (updateMessageTranscription, markMessageTranscriptionFailed)
-- predicated on 'pending'. Neither can match a row the claim has already
-- moved, so a voicemail would be downloaded from Twilio, sent to OpenAI, and
-- then have its transcript dropped - the message keeping its empty placeholder
-- body, and reside seeing transcription_status stuck in progress forever.
--
-- Resetting every such row is safe precisely because of that bug: nothing has
-- ever left 'transcribing' under its own power, so a row in that state is
-- stranded by definition rather than possibly in flight. The audio is
-- untouched at audio_url, and a transcript of an old voicemail is the same
-- transcript it would have been on the day - unlike a topic classification,
-- this does not go stale.
--
-- Ordering: migrations are applied by hand before the merge that deploys, so
-- between this running and the fixed worker reaching production the old code
-- can still strand a freshly-claimed row. Those are collected by the
-- stuck-claim sweep that follows this change, or by re-running the UPDATE.

UPDATE "messages"
SET "transcription_status" = 'pending'
WHERE "transcription_status" = 'transcribing';
