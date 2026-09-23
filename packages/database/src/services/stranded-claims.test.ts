import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import {
  conversations,
  documentChunks,
  documents,
  identities,
  messages,
  tenants,
} from "../schema";
import { asResideClientUid, type TenantId } from "@communication-canoe/shared/brands";

/**
 * The sweeps that unstick a claim whose replica died.
 *
 * Every one of these workers claims a row into a state that only it will move
 * out of, and every listPending* query selects 'pending' alone - so a bridge
 * that dies mid-tick (a deploy, an OOM, a Railway restart) leaves the row
 * invisible to every later tick, forever. One message had been sitting at
 * topic_check_status = 'processing' since 2026-08-11.
 *
 * The three do NOT resolve the same way, which is most of what is asserted
 * here: a voicemail and a document are replayed, a topic check is retired
 * without being classified. See each service method for the argument.
 */

const HOUR_MS = 60 * 60_000;

let db: TestDb;
let close: () => Promise<void>;
let domain: DomainService;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  domain = new DomainService(db);
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTestDb(db);
});

const cutoff = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

async function seedTenant(): Promise<{ tenantId: TenantId; conversationId: string }> {
  const [tenant] = await db.insert(tenants).values({
    name: "Tenant", twilioNumber: "+15550000001",
    inboundEmailAddress: "t@example.test", chatWidgetKey: "key",
    resideClientUid: asResideClientUid("client"),
  }).returning();
  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, email: "resident@example.test",
  }).returning();
  const [conversation] = await db.insert(conversations).values({
    tenantId: tenant.id, identityId: identity.id, status: "open",
  }).returning();
  return { tenantId: tenant.id, conversationId: conversation.id };
}

async function seedClaimedMessage(
  claim: { topicCheckStatus: string } | { transcriptionStatus: string },
  claimedAt: Date | null,
): Promise<string> {
  const { tenantId, conversationId } = await seedTenant();
  const [message] = await db.insert(messages).values({
    tenantId, conversationId,
    channel: "email", direction: "inbound", senderType: "external",
    body: "the boiler is out again", claimedAt,
    ...claim,
  }).returning();
  return message.id;
}

describe("cancelStrandedTopicChecks", () => {
  it("retires a claim older than the cutoff without classifying it", async () => {
    const id = await seedClaimedMessage(
      { topicCheckStatus: "processing" },
      new Date(Date.now() - 2 * HOUR_MS),
    );

    expect(await domain.cancelStrandedTopicChecks(cutoff(HOUR_MS))).toBe(1);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    // 'reviewed', not 'pending'. Requeueing would hand splitConversation a
    // message whose created_at is weeks behind the conversation's current
    // history, and it sweeps every message from there onward.
    expect(row.topicCheckStatus).toBe("reviewed");
    expect(row.claimedAt).toBeNull();
  });

  it("leaves a fresh claim alone, so a live classify is not retired under itself", async () => {
    const id = await seedClaimedMessage({ topicCheckStatus: "processing" }, new Date());

    expect(await domain.cancelStrandedTopicChecks(cutoff(HOUR_MS))).toBe(0);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.topicCheckStatus).toBe("processing");
  });

  it("leaves a message that was never claimed alone", async () => {
    const id = await seedClaimedMessage({ topicCheckStatus: "pending" }, null);

    expect(await domain.cancelStrandedTopicChecks(cutoff(HOUR_MS))).toBe(0);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.topicCheckStatus).toBe("pending");
  });

  it("stamps claimed_at on the claim, so the sweep can age it", async () => {
    // Without this the sweep's `claimed_at < cutoff` never matches and the
    // whole mechanism is inert - the failure mode would be silence.
    const id = await seedClaimedMessage({ topicCheckStatus: "pending" }, null);

    expect(await domain.claimTopicCheckMessage(id)).not.toBeNull();

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.claimedAt).toBeInstanceOf(Date);
  });
});

describe("reclaimStrandedVoicemailTranscriptions", () => {
  it("returns a stranded voicemail to pending so it transcribes again", async () => {
    const id = await seedClaimedMessage(
      { transcriptionStatus: "transcribing" },
      new Date(Date.now() - 2 * HOUR_MS),
    );

    expect(await domain.reclaimStrandedVoicemailTranscriptions(cutoff(HOUR_MS))).toBe(1);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    // Replayed, not retired - the audio is still at audio_url, and retiring
    // leaves a message whose whole content is permanently "".
    expect(row.transcriptionStatus).toBe("pending");
    expect(row.claimedAt).toBeNull();
  });

  it("leaves a fresh claim alone, so a slow Whisper call is not duplicated", async () => {
    const id = await seedClaimedMessage({ transcriptionStatus: "transcribing" }, new Date());

    expect(await domain.reclaimStrandedVoicemailTranscriptions(cutoff(HOUR_MS))).toBe(0);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.transcriptionStatus).toBe("transcribing");
  });

  it("stamps claimed_at on the claim, so the sweep can age it", async () => {
    const id = await seedClaimedMessage({ transcriptionStatus: "pending" }, null);

    expect(await domain.claimVoicemailTranscription(id)).toBe(true);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.claimedAt).toBeInstanceOf(Date);
  });

  it("does not touch a topic check, which shares the claimed_at column", async () => {
    // One claimed_at serves both of this table's claims. They are disjoint in
    // practice - the recording-status webhook keeps voicemails out of the
    // topic check - but each sweep still has to be pinned by its own status,
    // or one worker's sweep silently resolves the other's rows.
    const id = await seedClaimedMessage(
      { topicCheckStatus: "processing" },
      new Date(Date.now() - 2 * HOUR_MS),
    );

    expect(await domain.reclaimStrandedVoicemailTranscriptions(cutoff(HOUR_MS))).toBe(0);

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.topicCheckStatus).toBe("processing");
  });
});

describe("reclaimStrandedDocuments", () => {
  async function seedDocument(status: string, updatedAt: Date) {
    const { tenantId } = await seedTenant();
    const [doc] = await db.insert(documents).values({
      tenantId, filename: "lease.pdf", contentText: "the whole lease",
      extractor: "pdf", status, updatedAt,
    }).returning();
    return { id: doc.id, tenantId };
  }

  it("returns a stranded document to pending", async () => {
    const { id } = await seedDocument("processing", new Date(Date.now() - 2 * HOUR_MS));

    expect(await domain.reclaimStrandedDocuments(cutoff(HOUR_MS))).toBe(1);

    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row.status).toBe("pending");
  });

  it("deletes chunks the dead replica had already written", async () => {
    // The gap between insertDocumentChunks and markDocumentReady. Without
    // this delete, re-ingesting inserts a second copy of every chunk -
    // document_chunks has no unique on (document_id, chunk_index), and
    // retrieval's per-document diversity cap then lets the duplicates crowd
    // out every other source in the top-K.
    const { id, tenantId } = await seedDocument("processing", new Date(Date.now() - 2 * HOUR_MS));
    await db.insert(documentChunks).values([
      { documentId: id, tenantId, chunkIndex: 0, content: "first half" },
      { documentId: id, tenantId, chunkIndex: 1, content: "second half" },
    ]);

    expect(await domain.reclaimStrandedDocuments(cutoff(HOUR_MS))).toBe(1);

    const left = await db.select().from(documentChunks).where(eq(documentChunks.documentId, id));
    expect(left).toEqual([]);
  });

  it("leaves a fresh claim and its chunks alone", async () => {
    const { id, tenantId } = await seedDocument("processing", new Date());
    await db.insert(documentChunks).values({
      documentId: id, tenantId, chunkIndex: 0, content: "first half",
    });

    expect(await domain.reclaimStrandedDocuments(cutoff(HOUR_MS))).toBe(0);

    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row.status).toBe("processing");
    const left = await db.select().from(documentChunks).where(eq(documentChunks.documentId, id));
    expect(left).toHaveLength(1);
  });

  it("does not disturb a document that finished ingesting", async () => {
    // 'ready' is old by definition - it is never touched again - so a sweep
    // keyed on age alone would delete the chunks of every healthy document
    // in the tenant. The status predicate is what stops that.
    const { id, tenantId } = await seedDocument("ready", new Date(Date.now() - 500 * HOUR_MS));
    await db.insert(documentChunks).values({
      documentId: id, tenantId, chunkIndex: 0, content: "indexed and retrievable",
    });

    expect(await domain.reclaimStrandedDocuments(cutoff(HOUR_MS))).toBe(0);

    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row.status).toBe("ready");
    const left = await db.select().from(documentChunks).where(eq(documentChunks.documentId, id));
    expect(left).toHaveLength(1);
  });
});
