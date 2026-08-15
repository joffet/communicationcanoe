export const CONVERSATION_STATUSES = ["open", "pending", "resolved"] as const;
export const MESSAGE_CHANNELS = ["voice", "sms", "email", "web_chat"] as const;
export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const SENDER_TYPES = ["external", "internal_user", "ai_agent", "system"] as const;
export const LIVE_TRANSFER_CHANNELS = ["voice", "web_chat"] as const;
export const LIVE_TRANSFER_OUTCOMES = ["pending", "answered", "no_answer", "declined"] as const;
export const MESSAGE_DELIVERY_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "undelivered",
  "canceled",
] as const;
export const TENANT_PROVISIONING_SOURCES = ["manual", "reside"] as const;
export const MESSAGE_VISIBILITIES = ["internal", "external"] as const;
export const MESSAGE_AI_REVIEW_STATUSES = ["pending", "approved", "flagged"] as const;
export const MESSAGE_TOPIC_CHECK_STATUSES = ["pending", "processing", "reviewed"] as const;
/** "transcribing" is a claim held by one worker replica while it does the
 * expensive OpenAI call - see claimVoicemailTranscription. */
export const MESSAGE_TRANSCRIPTION_STATUSES = ["pending", "transcribing", "ready", "failed"] as const;
export const CONVERSATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type SenderType = (typeof SENDER_TYPES)[number];
export type LiveTransferChannel = (typeof LIVE_TRANSFER_CHANNELS)[number];
export type LiveTransferOutcome = (typeof LIVE_TRANSFER_OUTCOMES)[number];
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];
export type TenantProvisioningSource = (typeof TENANT_PROVISIONING_SOURCES)[number];
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];
export type MessageAiReviewStatus = (typeof MESSAGE_AI_REVIEW_STATUSES)[number];
export type MessageTopicCheckStatus = (typeof MESSAGE_TOPIC_CHECK_STATUSES)[number];
export type MessageTranscriptionStatus = (typeof MESSAGE_TRANSCRIPTION_STATUSES)[number];
export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number];

export const TENANT_COOKIE = "canoe-tenant-id";
