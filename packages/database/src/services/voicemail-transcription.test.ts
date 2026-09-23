import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainService } from "./index";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import { conversations, identities, messages, tenants } from "../schema";
import { asResideClientUid, type TenantId } from "@communication-canoe/shared/brands";

/**
 * The claim and its terminal writes, asserted against each other.
 *
 * 3a49882 put claimVoicemailTranscription (pending -> transcribing) in front
 * of writes that still predicated on 'pending', so every one of them matched
 * zero rows: the transcript was fetched, paid for and dropped, and the
 * voicemail sat at 'transcribing' forever with an empty body. Nothing caught
 * it, because each method was only ever exercised on its own - a claim test
 * and a write test both pass while the pair is broken. These run the two in
 * sequence, which is the only arrangement that can see it.
 */

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

async function seedVoicemail(): Promise<{ id: string; tenantId: TenantId }> {
  const [tenant] = await db.insert(tenants).values({
    name: "Tenant", twilioNumber: "+15550000001",
    inboundEmailAddress: "t@example.test", chatWidgetKey: "key",
    resideClientUid: asResideClientUid("client"),
  }).returning();
  const [identity] = await db.insert(identities).values({
    tenantId: tenant.id, phone: "+15551230000",
  }).returning();
  const [conversation] = await db.insert(conversations).values({
    tenantId: tenant.id, identityId: identity.id, status: "open",
  }).returning();
  // Exactly what the recording-status webhook writes: an empty placeholder
  // whose only content is the audio the worker has yet to transcribe.
  const [message] = await db.insert(messages).values({
    tenantId: tenant.id, conversationId: conversation.id,
    channel: "voice", direction: "inbound", senderType: "external",
    body: "", audioUrl: "https://api.twilio.test/Recordings/RE1",
    transcriptionStatus: "pending",
  }).returning();
  return { id: message.id, tenantId: tenant.id };
}

const statusOf = async (id: string) => {
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  return row;
};

describe("voicemail transcription claim and terminal writes", () => {
  it("writes the transcript onto a message this replica claimed", async () => {
    const { id } = await seedVoicemail();
    expect(await domain.claimVoicemailTranscription(id)).toBe(true);

    await domain.updateMessageTranscription(id, "the dishwasher is leaking again");

    const row = await statusOf(id);
    expect(row.transcriptionStatus).toBe("ready");
    expect(row.transcript).toBe("the dishwasher is leaking again");
    // The body matters as much as the transcript: it is what the thread
    // renders, what reside receives, and what triggerConversationRouting
    // classifies the conversation on. Left empty, team routing runs on "".
    expect(row.body).toBe("the dishwasher is leaking again");
  });

  it("records a failure reason on a message this replica claimed", async () => {
    const { id } = await seedVoicemail();
    expect(await domain.claimVoicemailTranscription(id)).toBe(true);

    await domain.markMessageTranscriptionFailed(id, "Failed to download recording: 404");

    const row = await statusOf(id);
    expect(row.transcriptionStatus).toBe("failed");
    expect(row.transcriptionFailureReason).toBe("Failed to download recording: 404");
  });

  it("claims once, so a second replica does not transcribe the same audio", async () => {
    const { id } = await seedVoicemail();
    expect(await domain.claimVoicemailTranscription(id)).toBe(true);
    expect(await domain.claimVoicemailTranscription(id)).toBe(false);
  });

  it("leaves an unclaimed message alone, so a pre-claim throw retries later", async () => {
    // The worker's catch block fires for throws on both sides of the claim.
    // For the one that happens before it - the claim's own round trip - the
    // row is still 'pending' and untouched by anyone, so failing it here
    // would burn a voicemail nobody ever attempted.
    const { id } = await seedVoicemail();

    await domain.markMessageTranscriptionFailed(id, "connection reset");

    const row = await statusOf(id);
    expect(row.transcriptionStatus).toBe("pending");
    expect(row.transcriptionFailureReason).toBeNull();
  });

  it("does not overwrite a finished transcription with a stale replica's result", async () => {
    // Replica A claims and hangs. A sweep returns the row to pending, B
    // claims it and finishes. A then wakes up and writes. Without the status
    // predicate it would land its stale transcript on top of B's.
    const { id } = await seedVoicemail();
    expect(await domain.claimVoicemailTranscription(id)).toBe(true);
    await domain.updateMessageTranscription(id, "B's transcript");

    await domain.updateMessageTranscription(id, "A's stale transcript");

    expect((await statusOf(id)).transcript).toBe("B's transcript");
  });
});
