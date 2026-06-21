import { z } from "zod";
import {
  CONVERSATION_STATUSES,
  MESSAGE_CHANNELS,
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
});

export const identityContactSchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
  })
  .refine((data) => Boolean(data.phone || data.email), {
    message: "At least one of phone or email is required",
  });

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

export type AppendMessageInput = z.infer<typeof appendMessageInputSchema>;
export type IdentityContact = z.infer<typeof identityContactSchema>;
export type AnonymousIdentityInput = z.infer<typeof anonymousIdentitySchema>;
export type ConvertIdentityInput = z.infer<typeof convertIdentityInputSchema>;
export type LogLiveTransferInput = z.infer<typeof logLiveTransferInputSchema>;
export type ConversationFilters = z.infer<typeof conversationFiltersSchema>;
