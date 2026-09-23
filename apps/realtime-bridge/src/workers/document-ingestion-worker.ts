import { createDomainService } from "@communication-canoe/database";
import { createEmbeddingProvider } from "@communication-canoe/shared/ai";
import { chunkDocumentText } from "@communication-canoe/shared/knowledge";
import { startPollLoop } from "./poll-loop.js";

const POLL_INTERVAL_MS = 10_000;
/** reside waits on nothing here - it gets its 202 the moment the row is
 * written - so the only cost of a late tick is a document that becomes
 * searchable a little later. */
const IDLE_POLL_INTERVAL_MS = 120_000;
const BATCH_LIMIT = 5;
const DEFAULT_MAX_KNOWLEDGE_CHUNKS = 5000;
/** How long a claimed ("processing") document may sit unresolved before a later
 * tick assumes the claiming replica died and returns it to pending. The longest
 * of the three: one claim covers chunking plus an embedding call over every
 * chunk of the document, and the cap is 5000 of them. */
const STUCK_CLAIM_TIMEOUT_MS = 30 * 60_000;

/**
 * Phase 10: async half of RAG document ingestion. reside extracts text
 * synchronously in the upload request and calls
 * POST /api/internal/reside/knowledge-documents, which creates a `documents`
 * row at status: 'pending' and returns immediately - this worker claims it,
 * chunks the text, embeds each chunk, and writes `document_chunks`, mirroring
 * the same poll+claim shape as conversation-routing-worker.ts (claiming is
 * required here too: chunking+embedding is the non-idempotent side effect,
 * happening before any terminal write, so a plain conditional update on the
 * final write wouldn't stop two overlapping ticks from both ingesting the
 * same document).
 */
export function startDocumentIngestionWorker(): void {
  startPollLoop({
    name: "document-ingestion-worker",
    activeIntervalMs: POLL_INTERVAL_MS,
    idleIntervalMs: IDLE_POLL_INTERVAL_MS,
    tick: ingestPendingDocuments,
  });
}

async function ingestPendingDocuments(): Promise<boolean> {
  const domain = createDomainService();

  // Put back anything a previous replica claimed but died before resolving.
  // Worth replaying: a document stuck at 'processing' has no chunks anyone can
  // retrieve, so it is invisible to RAG until someone re-uploads it. The sweep
  // also drops any chunks the dead replica had already written - without that,
  // re-ingesting would insert a second copy of every one.
  const reclaimed = await domain.reclaimStrandedDocuments(
    new Date(Date.now() - STUCK_CLAIM_TIMEOUT_MS).toISOString(),
  );
  if (reclaimed > 0) {
    console.log(`[document-ingestion-worker] reclaimed ${reclaimed} stranded document(s)`);
  }

  const ids = await domain.listPendingDocumentIds(BATCH_LIMIT);
  if (ids.length === 0) return false;

  console.log(`[document-ingestion-worker] ${ids.length} document(s) awaiting ingestion`);

  for (const id of ids) {
    try {
      const claimed = await domain.claimPendingDocument(id);
      if (!claimed) continue; // another tick already claimed it

      const chunks = chunkDocumentText(claimed.contentText);
      if (chunks.length === 0) {
        await domain.markDocumentFailed(id, "No content extracted after chunking");
        continue;
      }

      // Defensive re-check: the create endpoint enforces the tenant's chunk
      // cap at accept time, but a single large document can still produce
      // more chunks than the remaining budget by the time ingestion runs.
      const settings = await domain.getTenantSettings(claimed.tenantId);
      const maxChunks = settings?.maxKnowledgeChunks ?? DEFAULT_MAX_KNOWLEDGE_CHUNKS;
      const existingChunks = await domain.countTenantChunks(claimed.tenantId);
      if (existingChunks + chunks.length > maxChunks) {
        await domain.markDocumentFailed(
          id,
          `Ingesting this document would exceed the tenant's knowledge chunk limit (${maxChunks})`,
        );
        continue;
      }

      const embeddingProvider = createEmbeddingProvider();
      const embeddings = await embeddingProvider.embed(chunks.map((c) => c.content));

      await domain.insertDocumentChunks(
        chunks.map((chunk, i) => ({
          documentId: id,
          tenantId: claimed.tenantId,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          embedding: embeddings[i],
        })),
      );

      await domain.markDocumentReady(id);
    } catch (err) {
      console.error(`[document-ingestion-worker] document ${id} failed:`, err);
      // Never left stuck at pending/processing - same safety-net convention
      // as every other worker in this codebase.
      await domain
        .markDocumentFailed(id, err instanceof Error ? err.message : "Ingestion failed")
        .catch((innerErr) => {
          console.error(`[document-ingestion-worker] failed to record failure for ${id}:`, innerErr);
        });
    }
  }

  return true;
}
