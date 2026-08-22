const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

/** The pixel is fetched from inside a mail client; a slow or unreachable
 * reside must not hold the image open. */
const TIMEOUT_MS = 3000;

/**
 * Tells reside that a notification email it asked us to send has been opened,
 * so its inbox can show that alongside the notification.
 *
 * reside decides what to do with it, and deliberately does NOT treat it as a
 * read receipt: this pixel is fetched by Apple Mail Privacy Protection and
 * Gmail's image proxy with no human involved.
 *
 * Best-effort, matching notify-activity.ts: never throws, and never blocks
 * the tracking pixel's response. Most messages we send have no reside
 * notification behind them at all (Notices, admin replies) - reside 200s
 * those as unmatched rather than erroring, so an unmatched id is not
 * something to log as a failure here.
 */
export async function notifyResideMessageOpened(input: {
  messageId: string;
  openedAt: Date;
}): Promise<void> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) return;

  try {
    const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/message-opened`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-comm-canoe-secret": RESIDE_API_SECRET_OUT,
      },
      body: JSON.stringify({
        messageId: input.messageId,
        openedAt: input.openedAt.toISOString(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[notify-message-opened] reside call failed (${response.status}): ${await response.text()}`,
      );
    }
  } catch (err) {
    console.error("[notify-message-opened] reside call threw:", err);
  }
}
