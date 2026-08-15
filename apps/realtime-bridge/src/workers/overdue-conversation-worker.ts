import { createAdminService, createDomainService } from "@communication-canoe/database";
import { notifyResideResponseOverdue } from "../reside/notify-response-overdue.js";

const POLL_INTERVAL_MS = 5 * 60_000;
const BATCH_LIMIT = 25;

/**
 * Scans for conversations whose response_due_at (set/cleared entirely by a
 * Postgres trigger on message insert - see migration 20250701001000, not
 * application code) has elapsed with no reply, and notifies reside once per
 * overdue episode. SLA timers are comm-canoe's own state to monitor, so this
 * follows the same "comm-canoe detects and pushes" shape Phase 1's
 * bounce-threshold and Phase 4's activity-notify already established,
 * rather than reside polling comm-canoe on a cron schedule. Structured
 * identically to scheduled-message-worker.ts - same poll + atomic-claim
 * shape, same "single instance, no distributed coordination" risk
 * acceptance.
 */
export function startOverdueConversationWorker(): void {
  setInterval(() => {
    void notifyOverdueConversations().catch((err) => {
      console.error("[overdue-conversation-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[overdue-conversation-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function notifyOverdueConversations(): Promise<void> {
  const domain = createDomainService();
  const admin = createAdminService();

  const ids = await domain.listOverdueConversationIds(BATCH_LIMIT);
  if (ids.length === 0) return;

  console.log(`[overdue-conversation-worker] ${ids.length} conversation(s) overdue`);

  for (const id of ids) {
    try {
      // Atomic notified_at-IS-NULL -> now() transition: if another tick (or
      // an outbound reply's trigger clearing it back to null) beat this one
      // to the row, claimOverdueConversationNotification returns null and
      // we skip - the entire race-safety/dedup mechanism.
      const claimed = await domain.claimOverdueConversationNotification(id);
      if (!claimed) continue;

      const thread = await domain.getConversationThread(claimed.id);
      const who = thread?.identity.name ?? thread?.identity.email ?? thread?.identity.phone ?? "a resident";

      // claimed.tenant_id is comm-canoe's internal uuid - reside matches on its
      // own client uid, so translate before notifying.
      const tenant = await admin.getTenantById(claimed.tenant_id);
      if (!tenant) continue;

      await notifyResideResponseOverdue({
        resideClientUid: tenant.reside_client_uid,
        conversationId: claimed.id,
        summary: `Response overdue for ${who}`,
      });
    } catch (err) {
      console.error(`[overdue-conversation-worker] conversation ${id} failed:`, err);
    }
  }
}
