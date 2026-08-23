export type RealtimeMode = "voice" | "text";

export type RealtimeToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const TRANSFER_TO_HUMAN_TOOL: RealtimeToolDefinition = {
  type: "function",
  name: "transfer_to_human",
  description:
    "Transfer the conversation to a human team member when the customer requests it or escalation is needed.",
  // No conversation_id argument: both sessions already know which conversation
  // they are bound to, and nothing ever tells the model a real one - so the
  // argument could only ever carry a value the model invented or a caller
  // suggested, while deciding which conversation the transfer is logged
  // against. `reason` is the model's own account, which is what it can supply.
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why the transfer is needed" },
    },
    required: ["reason"],
  },
};

export const CAPTURE_CONTACT_INFO_TOOL: RealtimeToolDefinition = {
  type: "function",
  name: "capture_contact_info",
  description:
    "Capture the visitor's contact information when they provide name, email, or phone during chat.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
    },
  },
};

export function getToolsForMode(mode: RealtimeMode): RealtimeToolDefinition[] {
  const tools: RealtimeToolDefinition[] = [TRANSFER_TO_HUMAN_TOOL];
  if (mode === "text") tools.push(CAPTURE_CONTACT_INFO_TOOL);
  return tools;
}

export type TransferToHumanArgs = {
  reason: string;
};

export type CaptureContactInfoArgs = {
  name?: string;
  email?: string;
  phone?: string;
};
