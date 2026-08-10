import { z } from "zod";
import {
  CONVERSATION_STATUSES,
  MESSAGE_CHANNELS,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  SENDER_TYPES,
} from "../constants";

export const appendMessageInputSchema = z.object({
  tenantId: z.string().uuid(),
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

export const provisionTenantInputSchema = z.object({
  resideClientUid: z.string().uuid(),
  name: z.string().min(1),
  twilioNumber: z.string().min(1),
  inboundEmailAddress: z.string().email(),
});

export const resideSendMessageInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    channel: z.enum(["sms", "email"]),
    identity: identityContactBaseSchema,
    body: z.string().min(1),
    subject: z.string().optional(),
    conversationId: z.string().uuid().optional(),
  })
  .refine((data) => Boolean(data.identity.phone || data.identity.email), {
    message: "identity requires at least one of phone or email",
    path: ["identity"],
  })
  .refine((data) => data.channel !== "email" || Boolean(data.subject), {
    message: "subject is required when channel is email",
    path: ["subject"],
  });

export type AppendMessageInput = z.infer<typeof appendMessageInputSchema>;
export type IdentityContact = z.infer<typeof identityContactSchema>;
export type AnonymousIdentityInput = z.infer<typeof anonymousIdentitySchema>;
export type ConvertIdentityInput = z.infer<typeof convertIdentityInputSchema>;
export type LogLiveTransferInput = z.infer<typeof logLiveTransferInputSchema>;
export type ConversationFilters = z.infer<typeof conversationFiltersSchema>;
export type ProvisionTenantInput = z.infer<typeof provisionTenantInputSchema>;
export type ResideSendMessageInput = z.infer<typeof resideSendMessageInputSchema>;
