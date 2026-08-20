import { getTableColumns } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  conversationAssignees,
  conversationParticipants,
  conversations,
  documents,
  identities,
  messages,
  tags,
} from "./schema/index";
import type {
  Conversation,
  ConversationAssignee,
  ConversationParticipant,
  ConversationThread,
  ConversationWithIdentity,
  Document,
  Identity,
  Message,
  Tag,
} from "./types";

/**
 * Serializers for the reside-facing API, which speaks snake_case.
 *
 * Reside declares this contract in its own `CommCanoeConversation` /
 * `CommCanoeMessage` types and reads the fields by those names. Nothing
 * validates the payload against them on arrival, so a shape change does not
 * fail - it silently yields `undefined` for every field whose name has more
 * than one word, while `id`, `status` and `summary` keep working by
 * coincidence. That is how the Drizzle migration took reside's admin inbox
 * out for a day without an error anywhere: the routes returned service rows
 * directly, and those rows became camelCase.
 *
 * These live here, beside the schema, so the snake_case names can be asserted
 * against the column definitions rather than retyped from memory - see
 * reside-wire.test.ts, which fails if a wire key stops matching the column it
 * claims to carry. A rename in the ORM layer is then a failing test, not a
 * silent contract break.
 *
 * Timestamps cross as ISO strings because reside declares them `string`.
 * Drizzle hands back `Date`, and `JSON.stringify` would produce the same text
 * by accident - stated explicitly here so it stays true if that ever changes.
 */

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Column name as declared in the schema, for the tests to check against. */
export function columnName(table: PgTable, key: string): string {
  const column = (getTableColumns(table) as Record<string, AnyPgColumn>)[key];
  if (!column) throw new Error(`No column ${key} on table`);
  return column.name;
}

export type ResideWireIdentity = {
  id: string;
  tenant_id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  is_anonymous: boolean;
};

export function toResideIdentity(row: Identity): ResideWireIdentity {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    phone: row.phone,
    email: row.email,
    name: row.name,
    is_anonymous: row.isAnonymous,
  };
}

export type ResideWireTag = {
  id: string;
  tenant_id: string;
  name: string;
  color: string | null;
  created_at: string | null;
};

export function toResideTag(row: Tag): ResideWireTag {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    name: row.name,
    color: row.color,
    created_at: iso(row.createdAt),
  };
}

export type ResideWireParticipant = {
  id: string;
  conversation_id: string;
  identity_id: string | null;
  user_id: string | null;
  role: string;
  created_at: string | null;
};

export function toResideParticipant(row: ConversationParticipant): ResideWireParticipant {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    identity_id: row.identityId,
    user_id: row.userId,
    role: row.role,
    created_at: iso(row.createdAt),
  };
}

export type ResideWireAssignee = {
  conversation_id: string;
  user_id: string;
  assigned_at: string | null;
  assigned_by: string | null;
  /** Only the thread route resolves this; the list route omits it entirely
   * rather than sending a null that reside cannot distinguish from "no
   * matching reside admin". */
  reside_user_id?: string | null;
};

export function toResideAssignee(
  row: ConversationAssignee & { reside_user_id?: string | null },
): ResideWireAssignee {
  const wire: ResideWireAssignee = {
    conversation_id: row.conversationId,
    user_id: row.userId,
    assigned_at: iso(row.assignedAt),
    assigned_by: row.assignedBy,
  };
  if ("reside_user_id" in row) wire.reside_user_id = row.reside_user_id;
  return wire;
}

export type ResideWireMessage = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel: string;
  direction: string;
  sender_type: string;
  sender_id: string | null;
  body: string;
  subject: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  visibility: string;
  scheduled_send_at: string | null;
  ai_review_status: string | null;
  ai_review_reasoning: string | null;
  opened_at: string | null;
  transcription_status: string | null;
  transcription_failure_reason: string | null;
  created_at: string | null;
};

export function toResideMessage(row: Message): ResideWireMessage {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    conversation_id: row.conversationId,
    channel: row.channel,
    direction: row.direction,
    sender_type: row.senderType,
    sender_id: row.senderId,
    body: row.body,
    subject: row.subject,
    delivery_status: row.deliveryStatus,
    delivery_error: row.deliveryError,
    visibility: row.visibility,
    scheduled_send_at: iso(row.scheduledSendAt),
    ai_review_status: row.aiReviewStatus,
    ai_review_reasoning: row.aiReviewReasoning,
    opened_at: iso(row.openedAt),
    transcription_status: row.transcriptionStatus,
    transcription_failure_reason: row.transcriptionFailureReason,
    created_at: iso(row.createdAt),
  };
}

export type ResideWireConversation = {
  id: string;
  tenant_id: string;
  identity_id: string;
  status: string;
  assigned_team_id: string | null;
  assigned_user_id: string | null;
  summary: string | null;
  priority: string;
  response_due_at: string | null;
  merged_into_id: string | null;
  created_at: string | null;
  last_message_at: string | null;
};

/** The conversation columns alone - used by routes that return a bare
 * Conversation, such as the status PATCH. */
export function toResideConversationBase(row: Conversation): ResideWireConversation {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    identity_id: row.identityId,
    status: row.status,
    assigned_team_id: row.assignedTeamId,
    assigned_user_id: row.assignedUserId,
    summary: row.summary,
    priority: row.priority,
    response_due_at: iso(row.responseDueAt),
    merged_into_id: row.mergedIntoId,
    created_at: iso(row.createdAt),
    last_message_at: iso(row.lastMessageAt),
  };
}

export type ResideWireConversationWithIdentity = ResideWireConversation & {
  identity: ResideWireIdentity;
  participants: ResideWireParticipant[];
  tags: ResideWireTag[];
  assignees: ResideWireAssignee[];
};

export function toResideConversation(
  row: ConversationWithIdentity & {
    assignees: (ConversationAssignee & { reside_user_id?: string | null })[];
  },
): ResideWireConversationWithIdentity {
  return {
    ...toResideConversationBase(row),
    identity: toResideIdentity(row.identity),
    participants: row.participants.map(toResideParticipant),
    tags: row.tags.map(toResideTag),
    assignees: row.assignees.map(toResideAssignee),
  };
}

export type ResideWireConversationThread = ResideWireConversationWithIdentity & {
  messages: ResideWireMessage[];
};

export function toResideThread(
  row: ConversationThread & {
    assignees: (ConversationAssignee & { reside_user_id?: string | null })[];
  },
): ResideWireConversationThread {
  return {
    ...toResideConversation(row),
    messages: row.messages.map(toResideMessage),
  };
}

export type ResideWireKnowledgeDocument = {
  id: string;
  tenant_id: string;
  filename: string;
  extractor: string;
  page_count: number | null;
  status: string;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Deliberately omits contentText: it is the entire extracted document, reside
 * never declared it, and shipping it on a list endpoint would put every
 * building's uploaded text on the wire for a screen that renders filenames. */
export function toResideKnowledgeDocument(row: Document): ResideWireKnowledgeDocument {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    filename: row.filename,
    extractor: row.extractor,
    page_count: row.pageCount,
    status: row.status,
    failure_reason: row.failureReason,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

/** The tables each serializer above draws its wire names from. The test walks
 * this to prove every emitted key is the schema's own column name. */
export const RESIDE_WIRE_TABLES = {
  conversation: conversations,
  identity: identities,
  message: messages,
  tag: tags,
  assignee: conversationAssignees,
  participant: conversationParticipants,
  knowledgeDocument: documents,
} as const;
