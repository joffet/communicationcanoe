export const CONVERSATION_STATUSES = ["open", "pending", "resolved"] as const;
export const MESSAGE_CHANNELS = ["voice", "sms", "email"] as const;
export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const SENDER_TYPES = ["external", "internal_user", "ai_agent"] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type SenderType = (typeof SENDER_TYPES)[number];

export const TENANT_COOKIE = "contact-tenant-id";
