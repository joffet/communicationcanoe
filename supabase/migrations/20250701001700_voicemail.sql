-- Phase 11: voicemail transcription. audio_url/transcript columns already
-- exist on messages from the initial schema (20250620160000) - this only
-- adds the status machine a new async transcription worker needs.
-- 'pending' is set when a recording-status webhook creates the placeholder
-- message; the worker flips it to 'ready' (with body/transcript filled in)
-- or 'failed' (never left stuck), mirroring every other worker's status-
-- column convention in this codebase.
ALTER TABLE messages ADD COLUMN transcription_status TEXT CHECK (transcription_status IN ('pending', 'ready', 'failed'));
ALTER TABLE messages ADD COLUMN transcription_failure_reason TEXT;
