import { createDomainService } from "@communication-canoe/database";
import { createEmbeddingProvider } from "@communication-canoe/shared/ai";
import { chunkDocumentText } from "@communication-canoe/shared/knowledge";

const POLL_INTERVAL_MS = 10_000;
const BATCH_LIMIT = 5;
const DEFAULT_MAX_KNOWLEDGE_CHUNKS = 5000;

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
  setInterval(() => {
    void ingestPendingDocuments().catch((err) => {
      console.error("[document-ingestion-worker] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`[document-ingestion-worker] polling every ${POLL_INTERVAL_MS}ms`);
}

async function ingestPendingDocuments(): Promise<void> {
  const domain = createDomainService();

  const ids = await domain.listPendingDocumentIds(BATCH_LIMIT);
  if (ids.length === 0) return;

  console.log(`[document-ingestion-worker] ${ids.length} document(s) awaiting ingestion`);

  for (const id of ids) {
    try {
      const claimed = await domain.claimPendingDocument(id);
      if (!claimed) continue; // another tick already claimed it

      const chunks = chunkDocumentText(claimed.content_text);
      if (chunks.length === 0) {
        await domain.markDocumentFailed(id, "No content extracted after chunking");
        continue;
      }

      // Defensive re-check: the create endpoint enforces the tenant's chunk
      // cap at accept time, but a single large document can still produce
      // more chunks than the remaining budget by the time ingestion runs.
      const settings = await domain.getTenantSettings(claimed.tenant_id);
      const maxChunks = settings?.max_knowledge_chunks ?? DEFAULT_MAX_KNOWLEDGE_CHUNKS;
      const existingChunks = await domain.countTenantChunks(claimed.tenant_id);
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
          document_id: id,
          tenant_id: claimed.tenant_id,
          chunk_index: chunk.chunkIndex,
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
}
