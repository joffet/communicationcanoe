import { createAdminService, createDomainService } from "@communication-canoe/database";
import { dispatchOutboundMessage } from "@communication-canoe/messaging";

const POLL_INTERVAL_MS = 7_000;
const BATCH_LIMIT = 25;
/** How long a claimed ("sending") recipient may sit unresolved before another
 * tick assumes the claiming replica died and returns it to pending. Well above
 * the time a single dispatch takes, so a slow-but-alive send is never stolen
 * and re-dispatched. */
const STUCK_CLAIM_TIMEOUT_MS = 5 * 60_000;

/**
 * Drains reside's bulk-send queue (outbound_batches/outbound_batch_recipients -
 * see supabase/migrations/20250701000000_outbound_batches.sql), dispatching each
 * pending recipient through the same per-recipient machinery the single-send
 * endpoint uses (findOrCreateIdentity -> findOrCreateConversation ->
 * appendMessage -> dispatchOutboundMessage).
 *
 * This is the repo's first piece of recurring background-work infrastructure -
 * intentionally minimal (no row-locking, no distributed coordination). Safe as
 * long as only one realtime-bridge instance runs this loop; revisit if that
 * service is ever horizontally scaled.
 */
export function startOutboundBatchWorker(): void {
  setInterval(() => {
    void drainPendingRecipients().catch((err) => {
      console.error("[outbound-batch-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[outbound-batch-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function drainPendingRecipients(): Promise<void> {
  const domain = createDomainService();
  const admin = createAdminService();

  // Put back anything a previous replica claimed but died before resolving.
  const reclaimed = await domain.reclaimStuckOutboundBatchRecipients(
    new Date(Date.now() - STUCK_CLAIM_TIMEOUT_MS).toISOString(),
  );
  if (reclaimed > 0) {
    console.log(`[outbound-batch-worker] reclaimed ${reclaimed} stuck recipient(s)`);
  }

  const recipients = await domain.listPendingOutboundBatchRecipients(BATCH_LIMIT);
  if (recipients.length === 0) return;

  console.log(`[outbound-batch-worker] draining ${recipients.length} recipient(s)`);

  // Many recipients in one tick typically belong to the same batch/tenant -
  // cache both lookups within the tick rather than refetching per recipient.
  const tenantCache = new Map<string, Awaited<ReturnType<typeof admin.getTenantById>>>();
  const batchCache = new Map<string, Awaited<ReturnType<typeof domain.getOutboundBatch>>>();

  for (const recipient of recipients) {
    try {
      // Claim BEFORE any send. Without this two replicas both read the same
      // pending rows and both dispatch - on a Notice to hundreds of residents,
      // hundreds of duplicate emails. A lost claim just means another replica
      // owns this recipient.
      const claimed = await domain.claimOutboundBatchRecipient(recipient.id);
      if (!claimed) continue;

      let tenant = tenantCache.get(recipient.tenantId);
      if (tenant === undefined) {
        tenant = await admin.getTenantById(recipient.tenantId);
        tenantCache.set(recipient.tenantId, tenant);
      }
      if (!tenant) {
        await failRecipient(domain, recipient.id, recipient.batchId, `Unknown tenant: ${recipient.tenantId}`);
        continue;
      }

      let batch = batchCache.get(recipient.batchId);
      if (batch === undefined) {
        batch = await domain.getOutboundBatch(recipient.batchId);
        batchCache.set(recipient.batchId, batch);
      }

      const identity = recipient.identityContact as {
        phone?: string;
        email?: string;
        name?: string;
        resideResidentId?: string;
      };

      const to = recipient.channel === "sms" ? identity.phone : identity.email;
      if (!to) {
        await failRecipient(
          domain,
          recipient.id,
          recipient.batchId,
          `identity is missing ${recipient.channel === "sms" ? "phone" : "email"}`,
        );
        continue;
      }

      const resolvedIdentity = await domain.findOrCreateIdentity(recipient.tenantId, identity);
      // Outbound/system-attributed send - no topic to classify, isStale is
      // irrelevant here (Phase 9's staleness check only matters for
      // inbound resident messages).
      const { conversation } = await domain.findOrCreateConversation(recipient.tenantId, resolvedIdentity.id, {
        channel: recipient.channel,
      });

      const message = await domain.appendMessage({
        tenantId: recipient.tenantId,
        conversationId: conversation.id,
        channel: recipient.channel,
        direction: "outbound",
        senderType: "system",
        body: recipient.body,
        subject: batch?.subject ?? undefined,
        deliveryStatus: "queued",
        // Reside Notices/bulk-send recipients - actually delivered to residents.
        visibility: "external",
      });

      const sent = await dispatchOutboundMessage({ tenant, message, to });

      await domain.updateOutboundBatchRecipientStatus(recipient.id, {
        status: sent.delivery_status === "failed" ? "failed" : "sent",
        messageId: sent.id,
        error: sent.delivery_error ?? null,
      });
      await domain.incrementOutboundBatchCompleted(recipient.batchId);
    } catch (err) {
      console.error(`[outbound-batch-worker] recipient ${recipient.id} failed:`, err);
      await failRecipient(
        domain,
        recipient.id,
        recipient.batchId,
        err instanceof Error ? err.message : String(err),
      ).catch((innerErr) => {
        console.error(`[outbound-batch-worker] failed to record failure for ${recipient.id}:`, innerErr);
      });
    }
  }
}

async function failRecipient(
  domain: ReturnType<typeof createDomainService>,
  recipientId: string,
  batchId: string,
  error: string,
): Promise<void> {
  await domain.updateOutboundBatchRecipientStatus(recipientId, { status: "failed", error });
  await domain.incrementOutboundBatchCompleted(batchId);
}
