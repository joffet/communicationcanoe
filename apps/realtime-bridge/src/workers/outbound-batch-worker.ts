import { createAdminService, createDomainService } from "@communication-canoe/database";
import type { AdminService, DomainService } from "@communication-canoe/database";
import {
  createAttachmentFetchCache,
  dispatchOutboundMessage,
  type AttachmentFetchCache,
} from "@communication-canoe/messaging";

const POLL_INTERVAL_MS = 7_000;

/**
 * How many recipients one pass claims.
 *
 * Was 25, drained one at a time. Each recipient costs five or six database
 * round trips plus an SES call, so a pass took longer than the poll interval
 * and ticks overlapped - the atomic claim kept that correct, but the second
 * tick spent itself losing claims. A thousand-recipient notice took twenty
 * minutes of that.
 */
const BATCH_LIMIT = 100;

/**
 * How many of those run at once.
 *
 * The ceiling that matters is the SES account's sending rate, not this number
 * - exceed it and SES throttles, which surfaces as failed recipients rather
 * than as backpressure. Eight is deliberately below any production SES quota;
 * raise it against the account's real limit rather than by feel, and remember
 * every one of these also holds a database connection.
 */
const CONCURRENCY = Number(process.env.OUTBOUND_BATCH_CONCURRENCY ?? 8);

/** A pass stops after this many rounds even if work remains, so one enormous
 * batch cannot hold the loop past the next tick forever. What is left is
 * picked up on the following tick. */
const MAX_ROUNDS_PER_TICK = 10;
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
  // A tick that is still draining must not start a second one. The claim makes
  // an overlap safe rather than useful: the newcomer reads the same pending
  // rows, loses every claim to the pass already holding them, and spends a
  // round trip each to find that out.
  let draining = false;

  setInterval(() => {
    if (draining) return;
    draining = true;
    void drainPendingRecipients()
      .catch((err) => {
        console.error("[outbound-batch-worker] tick failed:", err);
      })
      .finally(() => {
        draining = false;
      });
  }, POLL_INTERVAL_MS);
  console.log(
    `[outbound-batch-worker] polling every ${POLL_INTERVAL_MS}ms, ${CONCURRENCY} at a time`,
  );
}

/** Runs tasks with a bounded number in flight. Hand-rolled rather than adding
 * p-limit for one call site: the workers package has no runtime dependencies
 * of its own and this is the whole of what would be imported. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      // `run` handles its own failures; anything escaping would kill this
      // worker and quietly reduce the concurrency for the rest of the pass.
      await run(item).catch((err) => {
        console.error("[outbound-batch-worker] unhandled recipient error:", err);
      });
    }
  });
  await Promise.all(workers);
}

type Caches = {
  tenants: Map<string, Promise<Awaited<ReturnType<AdminService["getTenantById"]>>>>;
  batches: Map<string, Promise<Awaited<ReturnType<DomainService["getOutboundBatch"]>>>>;
  /**
   * Attachment bytes, shared across every recipient in this pass.
   *
   * Not just a saving (a thousand-recipient notice would otherwise pull the
   * same PDF a thousand times, from reside, while reside is serving
   * residents) - it is what makes reside's short-lived signature workable
   * here. Those URLs carry a 30-minute HMAC minted when reside POSTed the
   * batch (its lib/reservations/agreementPdfUrl.ts). Fetching per recipient
   * would put the LAST recipient of a long batch outside that window; fetching
   * once per pass puts only the FIRST inside it, and the first is reached
   * within a poll interval of the batch being queued.
   *
   * Lives exactly as long as the `Caches` object - one drain pass - so the
   * bytes of a resident's personal document are not held in memory by a
   * process-lifetime cache. Bounded by the distinct attachments across the
   * batches touched in one pass, each already capped at
   * MAX_TOTAL_ATTACHMENT_BYTES (9MB) by fetchEmailAttachments.
   */
  attachments: AttachmentFetchCache;
};

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

  // Many recipients in one pass typically belong to the same batch/tenant -
  // cache both lookups rather than refetching per recipient. The PROMISE is
  // cached, not the result: with several recipients in flight at once, caching
  // the resolved value lets every one of them miss and fetch before the first
  // finishes writing it back.
  const caches: Caches = {
    tenants: new Map(),
    batches: new Map(),
    attachments: createAttachmentFetchCache(),
  };

  for (let round = 0; round < MAX_ROUNDS_PER_TICK; round++) {
    const recipients = await domain.listPendingOutboundBatchRecipients(BATCH_LIMIT);
    if (recipients.length === 0) return;

    console.log(
      `[outbound-batch-worker] draining ${recipients.length} recipient(s), round ${round + 1}`,
    );
    await mapWithConcurrency(recipients, CONCURRENCY, (recipient) =>
      processRecipient(domain, admin, caches, recipient),
    );

    // A short pass means the queue is drained; anything else and there is more
    // waiting, so keep going rather than idling until the next tick.
    if (recipients.length < BATCH_LIMIT) return;
  }
}

async function processRecipient(
  domain: ReturnType<typeof createDomainService>,
  admin: ReturnType<typeof createAdminService>,
  caches: Caches,
  recipient: Awaited<ReturnType<DomainService["listPendingOutboundBatchRecipients"]>>[number],
): Promise<void> {
  try {
    // Claim BEFORE any send. Without this two replicas both read the same
    // pending rows and both dispatch - on a Notice to hundreds of residents,
    // hundreds of duplicate emails. A lost claim just means another replica
    // owns this recipient.
    const claimed = await domain.claimOutboundBatchRecipient(recipient.id);
    if (!claimed) return;

    let tenantPromise = caches.tenants.get(recipient.tenantId);
    if (!tenantPromise) {
      tenantPromise = admin.getTenantById(recipient.tenantId);
      caches.tenants.set(recipient.tenantId, tenantPromise);
    }
    const tenant = await tenantPromise;
    if (!tenant) {
      await failRecipient(domain, recipient.id, recipient.batchId, `Unknown tenant: ${recipient.tenantId}`);
      return;
    }

    let batchPromise = caches.batches.get(recipient.batchId);
    if (!batchPromise) {
      batchPromise = domain.getOutboundBatch(recipient.batchId);
      caches.batches.set(recipient.batchId, batchPromise);
    }
    const batch = await batchPromise;

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
      return;
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

    // The batch's From, when reside supplied one. Read from the batch rather
    // than the recipient for the same reason it is stored there: one notice,
    // one building, one sending identity.
    const sent = await dispatchOutboundMessage({
      tenant,
      message,
      to,
      from: batch?.fromAddress ?? undefined,
      // Read off the batch for the same reason the From is: one notice, one
      // building, one set of files. These are references exactly as reside
      // sent them - resolveAttachmentUrl and the fetch run inside dispatch,
      // on the same code path the single send uses, and a refused, expired or
      // oversized attachment is dropped there rather than failing this send.
      attachments: batch?.attachments ?? undefined,
      attachmentCache: caches.attachments,
    });

    await domain.updateOutboundBatchRecipientStatus(recipient.id, {
      status: sent.deliveryStatus === "failed" ? "failed" : "sent",
      messageId: sent.id,
      error: sent.deliveryError ?? null,
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

async function failRecipient(
  domain: ReturnType<typeof createDomainService>,
  recipientId: string,
  batchId: string,
  error: string,
): Promise<void> {
  await domain.updateOutboundBatchRecipientStatus(recipientId, { status: "failed", error });
  await domain.incrementOutboundBatchCompleted(batchId);
}
