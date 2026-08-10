export const CONVERSATION_STATUSES = ["open", "pending", "resolved"] as const;
export const MESSAGE_CHANNELS = ["voice", "sms", "email", "web_chat"] as const;
export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const SENDER_TYPES = ["external", "internal_user", "ai_agent", "system"] as const;
export const LIVE_TRANSFER_CHANNELS = ["voice", "web_chat"] as const;
export const LIVE_TRANSFER_OUTCOMES = ["pending", "answered", "no_answer", "declined"] as const;
export const MESSAGE_DELIVERY_STATUSES = ["queued", "sent", "delivered", "failed", "undelivered"] as const;
export const TENANT_PROVISIONING_SOURCES = ["manual", "reside"] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type SenderType = (typeof SENDER_TYPES)[number];
export type LiveTransferChannel = (typeof LIVE_TRANSFER_CHANNELS)[number];
export type LiveTransferOutcome = (typeof LIVE_TRANSFER_OUTCOMES)[number];
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];
export type TenantProvisioningSource = (typeof TENANT_PROVISIONING_SOURCES)[number];

export const TENANT_COOKIE = "canoe-tenant-id";
