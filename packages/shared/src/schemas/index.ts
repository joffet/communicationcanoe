import { z } from "zod";
import {
  CONVERSATION_STATUSES,
  MESSAGE_AI_REVIEW_STATUSES,
  MESSAGE_CHANNELS,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_TOPIC_CHECK_STATUSES,
  MESSAGE_TRANSCRIPTION_STATUSES,
  MESSAGE_VISIBILITIES,
  SENDER_TYPES,
} from "../constants";

export const appendMessageInputSchema = z.object({
  tenantId: z.string().uuid(),
  /** Set by reside-originated sends so its durable retry queue can re-send
   * after a lost response without delivering the message twice. */
  idempotencyKey: z.string().min(1).optional(),
  conversationId: z.string().uuid(),
  channel: z.enum(MESSAGE_CHANNELS),
  direction: z.enum(MESSAGE_DIRECTIONS),
  senderType: z.enum(SENDER_TYPES),
  senderId: z.string().uuid().optional(),
  body: z.string().default(""),
  subject: z.string().optional(),
  audioUrl: z.string().url().optional(),
  transcript: z.string().optional(),
  aiSummary: z.string().optional(),
  deliveryStatus: z.enum(MESSAGE_DELIVERY_STATUSES).optional(),
  // Optional at the schema level - the DB column defaults to 'internal', but
  // every existing call site explicitly passes 'external' (see Phase 2's 2C:
  // every message-writing flow that exists today already reached, or came
  // from, the customer). Only a future internal-note compose flow should
  // rely on the default.
  visibility: z.enum(MESSAGE_VISIBILITIES).optional(),
  scheduledSendAt: z.string().optional(),
  aiReviewStatus: z.enum(MESSAGE_AI_REVIEW_STATUSES).optional(),
  // Phase 9: set by the two inbound webhook callers when
  // findOrCreateConversation reports the resolved conversation was stale -
  // flags the message for the async conversation-routing-worker's AI
  // topic-shift check. Every other caller omits it (column defaults null).
  topicCheckStatus: z.enum(MESSAGE_TOPIC_CHECK_STATUSES).optional(),
  // Phase 11: set by the recording-status webhook on the empty-body
  // placeholder it creates for an inbound voicemail - flags the message for
  // the async voicemail-transcription-worker. Every other caller omits it.
  transcriptionStatus: z.enum(MESSAGE_TRANSCRIPTION_STATUSES).optional(),
});

export const identityContactBaseSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  resideResidentId: z.string().uuid().optional(),
});

export const identityContactSchema = identityContactBaseSchema.refine(
  (data) => Boolean(data.phone || data.email),
  { message: "At least one of phone or email is required" },
);

export const anonymousIdentitySchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  skipAnonymous: z.boolean().optional(),
});

export const convertIdentityInputSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const logLiveTransferInputSchema = z.object({
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid(),
  channel: z.enum(["voice", "web_chat"]),
  attemptedUserId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  outcome: z.enum(["pending", "answered", "no_answer", "declined"]),
});

export const conversationFiltersSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  assignedTeamId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

/* Every schema below is reside-facing, and their `tenantId`/`resideClientUid`
 * fields carry reside's OWN client identifier, which may be a slug such as
 * "cardiff" - hence `.min(1)` rather than `.uuid()`. Routes resolve that value
 * against the text `tenants.reside_client_uid` column and use the resulting
 * `tenant.id` for everything downstream. The two schemas above
 * (appendMessageInputSchema, logLiveTransferInputSchema) are internal and are
 * always called with comm-canoe's own uuid, so they stay strict. */
export const provisionTenantInputSchema = z.object({
  resideClientUid: z.string().min(1),
  name: z.string().min(1),
  twilioNumber: z.string().min(1),
  inboundEmailAddress: z.string().email(),
  /** This client's reside portal base URL, for per-client "View and reply"
   * links in resident emails. reside derives it from routingDomain and owns
   * the normalization; comm-canoe only appends a path. */
  resideAppUrl: z.string().url().optional(),
});

export const resideSendMessageInputSchema = z
  .object({
    tenantId: z.string().min(1),
    channel: z.enum(["sms", "email"]),
    identity: identityContactBaseSchema,
    body: z.string().min(1),
    subject: z.string().optional(),
    conversationId: z.string().uuid().optional(),
    /** Stable per logical message, reused across reside's retries. When a
     * message with this key already exists for the tenant the endpoint returns
     * it untouched instead of sending again - this is what makes reside's
     * durable retry safe after a lost/timed-out response. */
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .refine((data) => Boolean(data.identity.phone || data.identity.email), {
    message: "identity requires at least one of phone or email",
    path: ["identity"],
  })
  .refine((data) => data.channel !== "email" || Boolean(data.subject), {
    message: "subject is required when channel is email",
    path: ["subject"],
  });

export const resideSendBulkMessageInputSchema = z
  .object({
    tenantId: z.string().min(1),
    channel: z.enum(["sms", "email"]),
    body: z.string().min(1),
    subject: z.string().optional(),
    recipients: z.array(identityContactBaseSchema).min(1).max(2000),
  })
  .refine((data) => data.recipients.every((r) => Boolean(r.phone || r.email)), {
    message: "every recipient requires at least one of phone or email",
    path: ["recipients"],
  })
  .refine((data) => data.channel !== "email" || Boolean(data.subject), {
    message: "subject is required when channel is email",
    path: ["subject"],
  });

// ---- Phase 3: reside-attributed conversation actions ----
// Every write below is triggered by a reside admin acting through reside's
// native Inbox UI, not a comm-canoe session - the actor is always supplied
// explicitly (mirroring the SSO token's claim shape) and resolved server-side
// by resolveOrCreateResideActor (apps/web/src/lib/reside/resolve-actor.ts).
export const resideActorSchema = z.object({
  resideUserId: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["admin", "user", "super"]).optional(),
});

export const resideAddTagInputSchema = z.object({
  tenantId: z.string().min(1),
  tagName: z.string().min(1),
});

export const resideRemoveTagInputSchema = z.object({
  tenantId: z.string().min(1),
});

export const resideAssigneeInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
  assignee: resideActorSchema,
});

export const resideRemoveAssigneeInputSchema = z.object({
  tenantId: z.string().min(1),
});

export const resideParticipantInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
  participant: resideActorSchema,
});

export const resideConversationReplyInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
  channel: z.enum(["sms", "email"]),
  body: z.string().min(1),
  visibility: z.enum(MESSAGE_VISIBILITIES),
});

export const resideCancelScheduledMessageInputSchema = z.object({
  tenantId: z.string().min(1),
});

export const resideApproveFlaggedMessageInputSchema = z.object({
  tenantId: z.string().min(1),
});

export const resideUpdateConversationStatusInputSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(CONVERSATION_STATUSES),
});

// ---- Per-user read tracking + personal tags (Reside dashboard unread/relevance) ----
export const resideMarkReadInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
});

export const residePersonalTagInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
  target: resideActorSchema,
});

export const resideRemovePersonalTagInputSchema = z.object({
  tenantId: z.string().min(1),
});

// ---- Phase 4: resident-facing conversation endpoints ----
// The actor here is the resident themselves, identified by phone/email
// (matching however comm-canoe already resolves identities for outbound
// sends), not a resolved platform user - a fundamentally different anchor
// than Phase 3's resideActorSchema.
export const resideMemberListInputSchema = z.object({
  tenantId: z.string().min(1),
  contact: identityContactSchema,
});

export const resideMemberThreadInputSchema = z.object({
  tenantId: z.string().min(1),
  contact: identityContactSchema,
});

export const resideMemberReplyInputSchema = z.object({
  tenantId: z.string().min(1),
  contact: identityContactSchema,
  channel: z.enum(["sms", "email"]),
  body: z.string().min(1),
});

// ---- Phase 5: tenant-settings updates from reside ----
// Only the two fields reside needs to configure - not the full tenant_settings
// surface (greeting_message/business_hours/bounce_threshold etc. aren't
// reside-configurable yet and don't need to be for this phase).
export const resideUpdateTenantSettingsInputSchema = z.object({
  tenantId: z.string().min(1),
  defaultResponseWindowMinutes: z.number().int().positive().max(1440).optional(),
  externalSendDelaySeconds: z.number().int().min(0).max(3600).optional(),
  conversationStalenessMinutes: z.number().int().positive().max(10080).optional(),
  // Phase 10 feeder-gap fix: faq_snippets has existed on tenant_settings
  // since before this project started, but had zero write path anywhere in
  // either repo - suggestReply's FAQ input was always empty for a real
  // tenant as a result.
  faqSnippets: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).max(200).optional(),
});

// ---- Phase 7: conversation merging ----
export const resideMergeConversationsInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
  targetConversationId: z.string().uuid(),
});

// ---- Phase 8: conversation splitting (manual/admin-triggered only) ----
export const resideSplitConversationInputSchema = z.object({
  tenantId: z.string().min(1),
  actor: resideActorSchema,
  messageId: z.string().uuid(),
});

// ---- Phase 10: AI intermediate reply (real RAG) ----
// reside extracts text locally and sends only the extracted plain text here -
// comm-canoe never touches raw files or S3 (see contentText's size cap: a
// generous but real ceiling, matching reside's own ~15MB/~100-page upload
// validation, so a malformed request can't smuggle an unbounded payload
// through even though the real cap enforcement is the tenant document/chunk
// count check in the endpoint itself).
export const resideCreateKnowledgeDocumentInputSchema = z.object({
  tenantId: z.string().min(1),
  filename: z.string().min(1).max(500),
  contentText: z.string().min(1).max(2_000_000),
  extractor: z.string().min(1).max(100),
  pageCount: z.number().int().positive().optional(),
  uploadedBy: z.string().optional(),
});

export type ResideActorClaims = z.infer<typeof resideActorSchema>;
export type ResideAddTagInput = z.infer<typeof resideAddTagInputSchema>;
export type ResideAssigneeInput = z.infer<typeof resideAssigneeInputSchema>;
export type ResideParticipantInput = z.infer<typeof resideParticipantInputSchema>;
export type ResideConversationReplyInput = z.infer<typeof resideConversationReplyInputSchema>;
export type ResideMarkReadInput = z.infer<typeof resideMarkReadInputSchema>;
export type ResidePersonalTagInput = z.infer<typeof residePersonalTagInputSchema>;

export type AppendMessageInput = z.infer<typeof appendMessageInputSchema>;
export type IdentityContact = z.infer<typeof identityContactSchema>;
export type AnonymousIdentityInput = z.infer<typeof anonymousIdentitySchema>;
export type ConvertIdentityInput = z.infer<typeof convertIdentityInputSchema>;
export type LogLiveTransferInput = z.infer<typeof logLiveTransferInputSchema>;
export type ConversationFilters = z.infer<typeof conversationFiltersSchema>;
export type ProvisionTenantInput = z.infer<typeof provisionTenantInputSchema>;
export type ResideSendMessageInput = z.infer<typeof resideSendMessageInputSchema>;
export type ResideSendBulkMessageInput = z.infer<typeof resideSendBulkMessageInputSchema>;
export type ResideCreateKnowledgeDocumentInput = z.infer<typeof resideCreateKnowledgeDocumentInputSchema>;
