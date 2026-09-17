const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

const TIMEOUT_MS = 3000;

/**
 * Tells reside that an outbound email comm-canoe sent bounced or received a
 * spam complaint, so reside can stamp notice receipts, notifications, and its
 * email_deliveries ledger.
 *
 * Best-effort, matching notify-message-opened.ts: never throws, and only called
 * when comm-canoe already matched the SES message id to one of its messages.
 */
export async function notifyResideMessageBounced(input: {
  messageId: string;
  sesMessageId: string;
  bounceType?: string;
  bounceSubType?: string;
  diagnostic?: string;
  email?: string;
  occurredAt: Date;
  eventType: "Bounce" | "Complaint";
}): Promise<void> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) return;

  try {
    const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/message-bounced`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-comm-canoe-secret": RESIDE_API_SECRET_OUT,
      },
      body: JSON.stringify({
        messageId: input.messageId,
        sesMessageId: input.sesMessageId,
        bounceType: input.bounceType,
        bounceSubType: input.bounceSubType,
        diagnostic: input.diagnostic,
        email: input.email,
        occurredAt: input.occurredAt.toISOString(),
        eventType: input.eventType,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[notify-message-bounced] reside call failed (${response.status}): ${await response.text()}`,
      );
    }
  } catch (err) {
    console.error("[notify-message-bounced] reside call threw:", err);
  }
}
