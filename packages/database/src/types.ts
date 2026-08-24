// Domain types for comm-canoe, all inferred from the Drizzle schema.
//
// This file used to be two things. Alongside these, it carried a hand-written
// snake_case mirror of every table - 23 Row/Insert pairs, a TableDef wrapper,
// a DatabaseFunctions map of RPC signatures, and the `Database` type that
// composed them - which existed solely to parameterize
// SupabaseClient<Database>. The mirror described a query surface nobody used,
// in a casing nothing else here speaks, and it was deleted; see
// src/schema/notes.md for the inventory it contained. The client it
// parameterized outlived it by one cutover and is gone too - Realtime now runs
// on the bridge's own socket - so nothing in this package speaks to Supabase.
//
// Naming convention, now that the two shapes are one: a bare noun is the
// Drizzle select shape (`Tenant`, `Message`, `DocumentChunk`), `New<Noun>` is
// its insert shape (`NewDocumentChunk`). Every table-derived type is camelCase,
// matching the schema, and none of them is hand-maintained against the
// database - if a column changes, they change with it.
//
// The one deliberate exception is ConversationViewerState at the bottom, whose
// fields are snake_case because it is a wire shape reside consumes verbatim,
// not a table shape. Do not "fix" its casing.

import {
  conversationPersonalTags,
  documentChunks,
  tenantSettings,
  documents,
  liveTransfers,
  teams,
  tenants,
  users,
  conversations,
  identities,
  identityConversionLogs,
  messages,
  conversationAssignees,
  conversationParticipants,
  conversationReadStates,
  outboundBatches,
  outboundBatchRecipients,
  tags,
} from "./schema";

export type TenantSettings = typeof tenantSettings.$inferSelect;

export type PlatformRole = "user" | "super_admin";

export type User = typeof users.$inferSelect;

export type ConversationPriority = "low" | "normal" | "high" | "urgent";

export type MessageDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "canceled";

export type Tenant = typeof tenants.$inferSelect;
export type Identity = typeof identities.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type LiveTransfer = typeof liveTransfers.$inferSelect;
export type IdentityConversionLog = typeof identityConversionLogs.$inferSelect;
export type OutboundBatch = typeof outboundBatches.$inferSelect;
export type OutboundBatchRecipient = typeof outboundBatchRecipients.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type ConversationAssignee = typeof conversationAssignees.$inferSelect;
export type ConversationReadState = typeof conversationReadStates.$inferSelect;
export type ConversationPersonalTag = typeof conversationPersonalTags.$inferSelect;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
/** The Drizzle INSERT shape - camelCase fields, `Date` for created_at.
 * insertDocumentChunks writes through the ORM, so this is what its callers
 * build. */
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

/** Everyone else on the thread besides the primary `identity`/`assigned_user_id`
 * - additive per Phase 2's design (see conversation_participants migration),
 * never breaks the single-`identity` assumption existing consumers rely on.
 * `participants` is the raw join rows (not resolved Identity[]) since a
 * participant can be external (identity_id) OR internal (user_id) - callers
 * resolve whichever side they need. */
export type ConversationExtras = {
  participants: ConversationParticipant[];
  tags: Tag[];
  assignees: ConversationAssignee[];
};

export type ConversationWithIdentity = Conversation & {
  identity: Identity;
} & ConversationExtras;

/** Per-viewer enrichment (Reside dashboard unread/relevance). snake_case
 * because reside consumes these fields verbatim over the wire - this is an
 * API contract, not a table shape, and is the only type in this file whose
 * casing is not the schema's. Computed
 * relative to a single resolved viewer user id, never batched across all
 * tenant admins the way ConversationExtras is, since it's meaningless
 * without a specific viewer in mind. Kept out of ConversationExtras/
 * ConversationWithIdentity so every existing call site (comm-canoe's own
 * dashboard, the resident-facing member endpoints) is unaffected - only the
 * reside conversations list route opts in by passing a viewerUserId. */
export type ConversationViewerState = {
  viewer_is_relevant: boolean;
  viewer_has_unread: boolean;
  viewer_last_read_at: string | null;
};

export type ConversationThread = Conversation & {
  identity: Identity;
  messages: Message[];
} & ConversationExtras;
