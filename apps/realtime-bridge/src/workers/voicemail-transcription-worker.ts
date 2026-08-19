import { createDomainService } from "@communication-canoe/database";
import type { DomainService } from "@communication-canoe/database";
import { createTranscriptionProvider, routeConversation } from "@communication-canoe/shared/ai";
import { loadConfig } from "../config.js";

const POLL_INTERVAL_MS = 10_000;
const BATCH_LIMIT = 10;

/**
 * Phase 11: transcribes voicemails recorded via the new
 * apps/web/src/app/api/webhooks/twilio/recording-status webhook, which
 * creates an empty-body placeholder message (transcription_status:
 * 'pending') as soon as a recording completes. Same poll shape as
 * tone-review-worker.ts - a plain conditional update on write, not an
 * atomic claim like Phase 9/10's workers need, since re-transcribing the
 * same audio wastes an API call but doesn't corrupt state.
 */
export function startVoicemailTranscriptionWorker(): void {
  setInterval(() => {
    void transcribePendingVoicemails().catch((err) => {
      console.error("[voicemail-transcription-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[voicemail-transcription-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function transcribePendingVoicemails(): Promise<void> {
  const domain = createDomainService();
  const config = loadConfig();

  const ids = await domain.listPendingVoicemailTranscriptionMessageIds(BATCH_LIMIT);
  if (ids.length === 0) return;

  console.log(`[voicemail-transcription-worker] ${ids.length} voicemail(s) awaiting transcription`);

  for (const id of ids) {
    try {
      // Claim before the OpenAI call so two replicas can't both transcribe the
      // same voicemail (correctness is unaffected either way, but the spend
      // and the duplicate write are not).
      const claimed = await domain.claimVoicemailTranscription(id);
      if (!claimed) continue;

      const message = await domain.getMessageById(id);
      if (!message || !message.audioUrl) {
        await domain.markMessageTranscriptionFailed(id, "No audio_url on message");
        continue;
      }

      // Twilio recording media requires authenticated fetch - the same
      // account credentials already used for outbound SMS/call control.
      const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
      const audioResponse = await fetch(`${message.audioUrl}.mp3`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!audioResponse.ok) {
        throw new Error(`Failed to download recording: ${audioResponse.status}`);
      }
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

      const transcriptionProvider = createTranscriptionProvider();
      const transcript = await transcriptionProvider.transcribe(audioBuffer, "audio/mpeg");

      await domain.updateMessageTranscription(id, transcript);

      // Team-classification routing, now that real content exists (not at
      // placeholder-creation time). Inlined rather than imported - the
      // original apps/web/src/lib/ai/routing.ts's triggerConversationRouting
      // is self-contained (just DomainService + routeConversation, both
      // already available here), but realtime-bridge can't cross-import
      // from apps/web (separate app, no shared alias - same boundary Phase
      // 5's notify helpers respected by living in realtime-bridge instead).
      void triggerConversationRouting(domain, message.conversationId, message.tenantId).catch(console.error);
    } catch (err) {
      console.error(`[voicemail-transcription-worker] message ${id} failed:`, err);
      // Never left stuck at pending - same safety-net convention as every
      // other worker in this codebase.
      await domain
        .markMessageTranscriptionFailed(id, err instanceof Error ? err.message : "Transcription failed")
        .catch((innerErr) => {
          console.error(`[voicemail-transcription-worker] failed to record failure for ${id}:`, innerErr);
        });
    }
  }
}

/** Structural copy of apps/web/src/lib/ai/routing.ts's triggerConversationRouting -
 * see the call site's comment above for why it's inlined rather than shared. */
async function triggerConversationRouting(
  domain: DomainService,
  conversationId: string,
  tenantId: string,
): Promise<void> {
  const thread = await domain.getConversationThread(conversationId);
  if (!thread || thread.assigned_team_id) return;

  const teams = await domain.getTeamsForTenant(tenantId);
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) return;

  const result = await routeConversation({
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    messagePreview: lastInbound.body,
  });

  if (result.teamId) {
    await domain.assignConversationTeam(conversationId, result.teamId);
  }
}
