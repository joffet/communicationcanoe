import { describe, expect, it } from "vitest";
import {
  RESIDE_WIRE_TABLES,
  columnName,
  toResideAssignee,
  toResideConversation,
  toResideConversationBase,
  toResideIdentity,
  toResideKnowledgeDocument,
  toResideMessage,
  toResideParticipant,
  toResideTag,
  toResideThread,
} from "./reside-wire";

const AT = new Date("2026-08-19T10:00:00.000Z");

/* Every wire key, and the ORM key it carries. This is the contract reside
 * declares in CommCanoeConversation/CommCanoeMessage, restated so the test can
 * check both halves: that the serializer emits exactly these keys, and that
 * each one is the name the schema gives that column. Rename a column in the
 * ORM layer and the second half fails; drop or add a wire field and the first
 * half does. */
const WIRE_KEYS = {
  conversation: {
    id: "id",
    tenant_id: "tenantId",
    identity_id: "identityId",
    status: "status",
    assigned_team_id: "assignedTeamId",
    assigned_user_id: "assignedUserId",
    summary: "summary",
    priority: "priority",
    response_due_at: "responseDueAt",
    merged_into_id: "mergedIntoId",
    created_at: "createdAt",
    last_message_at: "lastMessageAt",
  },
  identity: {
    id: "id",
    tenant_id: "tenantId",
    phone: "phone",
    email: "email",
    name: "name",
    is_anonymous: "isAnonymous",
  },
  message: {
    id: "id",
    tenant_id: "tenantId",
    conversation_id: "conversationId",
    channel: "channel",
    direction: "direction",
    sender_type: "senderType",
    sender_id: "senderId",
    body: "body",
    subject: "subject",
    delivery_status: "deliveryStatus",
    delivery_error: "deliveryError",
    visibility: "visibility",
    scheduled_send_at: "scheduledSendAt",
    ai_review_status: "aiReviewStatus",
    ai_review_reasoning: "aiReviewReasoning",
    opened_at: "openedAt",
    transcription_status: "transcriptionStatus",
    transcription_failure_reason: "transcriptionFailureReason",
    created_at: "createdAt",
  },
  tag: { id: "id", tenant_id: "tenantId", name: "name", color: "color", created_at: "createdAt" },
  participant: {
    id: "id",
    conversation_id: "conversationId",
    identity_id: "identityId",
    user_id: "userId",
    role: "role",
    created_at: "createdAt",
  },
  assignee: {
    conversation_id: "conversationId",
    user_id: "userId",
    assigned_at: "assignedAt",
    assigned_by: "assignedBy",
  },
  knowledgeDocument: {
    id: "id",
    tenant_id: "tenantId",
    filename: "filename",
    extractor: "extractor",
    page_count: "pageCount",
    status: "status",
    failure_reason: "failureReason",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
} as const;

const identityRow = {
  id: "i1",
  tenantId: "t1",
  phone: null,
  email: "dana@example.test",
  name: "Dana Ruiz",
  isAnonymous: false,
  mergedIntoId: null,
  resideResidentId: null,
  emailConsecutiveFailures: 0,
  phoneConsecutiveFailures: 0,
  emailFlaggedAt: null,
  phoneFlaggedAt: null,
  createdAt: AT,
} as never;

const conversationRow = {
  id: "c1",
  tenantId: "t1",
  identityId: "i1",
  status: "open",
  assignedTeamId: null,
  assignedUserId: "u9",
  summary: "Leak in 402",
  priority: "high",
  responseDueAt: AT,
  responseOverdueNotifiedAt: AT,
  mergedIntoId: null,
  createdAt: AT,
  lastMessageAt: AT,
} as never;

const messageRow = {
  id: "m1",
  tenantId: "t1",
  conversationId: "c1",
  channel: "email",
  direction: "inbound",
  senderType: "external",
  senderId: null,
  body: "There is water in the hallway.",
  subject: "Leak",
  audioUrl: null,
  transcript: null,
  aiSummary: null,
  providerMessageId: null,
  deliveryStatus: "delivered",
  deliveryError: null,
  deliveryAttempts: 1,
  sentAt: AT,
  deliveredAt: AT,
  openedAt: null,
  visibility: "external",
  scheduledSendAt: null,
  aiReviewStatus: null,
  aiReviewReasoning: null,
  topicCheckStatus: null,
  idempotencyKey: null,
  transcriptionStatus: null,
  transcriptionFailureReason: null,
  createdAt: AT,
} as never;

const tagRow = { id: "g1", tenantId: "t1", name: "maintenance", color: "#f00", createdAt: AT } as never;
const participantRow = {
  id: "p1",
  conversationId: "c1",
  identityId: "i1",
  userId: null,
  role: "external",
  createdAt: AT,
} as never;
const assigneeRow = { conversationId: "c1", userId: "u9", assignedAt: AT, assignedBy: "u1" } as never;
const documentRow = {
  id: "d1",
  tenantId: "t1",
  filename: "house-rules.pdf",
  contentText: "the entire extracted document body",
  extractor: "pdf",
  pageCount: 12,
  status: "ready",
  failureReason: null,
  uploadedBy: "u1",
  createdAt: AT,
  updatedAt: AT,
} as never;

const withIdentity = {
  ...(conversationRow as object),
  identity: identityRow,
  participants: [participantRow],
  tags: [tagRow],
  assignees: [assigneeRow],
} as never;

describe("reside wire serializers", () => {
  const cases = [
    ["conversation", toResideConversationBase(conversationRow)],
    ["identity", toResideIdentity(identityRow)],
    ["message", toResideMessage(messageRow)],
    ["tag", toResideTag(tagRow)],
    ["participant", toResideParticipant(participantRow)],
    ["assignee", toResideAssignee(assigneeRow)],
    ["knowledgeDocument", toResideKnowledgeDocument(documentRow)],
  ] as const;

  it.each(cases)("emits exactly the wire keys reside declares for %s", (name, wire) => {
    const expected = Object.keys(WIRE_KEYS[name]).sort();
    expect(Object.keys(wire as object).sort()).toEqual(expected);
  });

  it.each(cases)("names every %s field after the column it carries", (name) => {
    const table = RESIDE_WIRE_TABLES[name];
    for (const [wireKey, ormKey] of Object.entries(WIRE_KEYS[name])) {
      expect(columnName(table, ormKey)).toBe(wireKey);
    }
  });

  it("sends timestamps as ISO strings, since reside declares them string", () => {
    const wire = toResideConversationBase(conversationRow);
    expect(wire.last_message_at).toBe("2026-08-19T10:00:00.000Z");
    expect(wire.created_at).toBe("2026-08-19T10:00:00.000Z");
    expect(toResideMessage(messageRow).opened_at).toBeNull();
  });

  it("does not leak columns reside never declared", () => {
    // responseOverdueNotifiedAt and the identity bounce counters are internal
    // bookkeeping; they sit on the same rows and must not cross the boundary.
    const wire = toResideConversation(withIdentity);
    expect(wire).not.toHaveProperty("response_overdue_notified_at");
    expect(wire).not.toHaveProperty("responseOverdueNotifiedAt");
    expect(wire.identity).not.toHaveProperty("email_consecutive_failures");
    expect(toResideMessage(messageRow)).not.toHaveProperty("delivery_attempts");
  });

  it("keeps the extracted document body off the wire", () => {
    // listDocumentsForTenant returns whole rows; contentText is the full text
    // of the upload and reside's list screen renders filenames.
    const wire = toResideKnowledgeDocument(documentRow);
    expect(wire).not.toHaveProperty("content_text");
    expect(wire).not.toHaveProperty("contentText");
    expect(wire).not.toHaveProperty("uploaded_by");
    expect(JSON.stringify(wire)).not.toContain("entire extracted document");
  });

  it("converts the nested identity, participants, tags and assignees too", () => {
    const wire = toResideConversation(withIdentity);
    expect(wire.identity).toMatchObject({ tenant_id: "t1", is_anonymous: false });
    expect(wire.participants[0]).toMatchObject({ conversation_id: "c1", identity_id: "i1" });
    expect(wire.tags[0]).toMatchObject({ tenant_id: "t1", created_at: "2026-08-19T10:00:00.000Z" });
    expect(wire.assignees[0]).toMatchObject({ user_id: "u9", assigned_by: "u1" });
  });

  it("carries reside_user_id only when the route resolved one", () => {
    expect(toResideAssignee(assigneeRow)).not.toHaveProperty("reside_user_id");
    const enriched = toResideAssignee({ ...(assigneeRow as object), reside_user_id: null } as never);
    expect(enriched).toHaveProperty("reside_user_id", null);
  });

  it("serializes a thread's messages", () => {
    const wire = toResideThread({ ...(withIdentity as object), messages: [messageRow] } as never);
    expect(wire.messages[0]).toMatchObject({
      conversation_id: "c1",
      sender_type: "external",
      created_at: "2026-08-19T10:00:00.000Z",
    });
  });

  /* The regression this whole module exists for: the routes used to return
   * service rows directly, so reside received `lastMessageAt` and read
   * `last_message_at` as undefined - no error, just a dashboard with no dates
   * that eventually threw inside Array.sort. */
  it("never emits a camelCase key", () => {
    const wire = toResideThread({ ...(withIdentity as object), messages: [messageRow] } as never);
    const keys = [
      ...Object.keys(wire),
      ...Object.keys(wire.identity),
      ...Object.keys(wire.messages[0]),
      ...Object.keys(wire.tags[0]),
      ...Object.keys(wire.participants[0]),
      ...Object.keys(wire.assignees[0]),
    ];
    expect(keys.filter((k) => /[A-Z]/.test(k))).toEqual([]);
  });
});
