const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

/** Somebody is waiting on a redirect behind this call; a slow or unreachable
 * reside must not hold them there. Same budget the open pixel uses. */
const TIMEOUT_MS = 3000;

/**
 * Tells reside that a link in a message it asked us to send was followed.
 *
 * The counterpart to notify-message-opened.ts, and deliberately its mirror
 * image in one respect: opens are forwarded only on the first, because an
 * image proxy re-fetches a cached pixel every time a message is displayed.
 * Clicks are forwarded every time, because each is a person choosing to go
 * somewhere - and a notice with two buttons is asking which one got pressed.
 * `firstClick` rides along so reside can tell "this person has now clicked
 * something" from "this is their fourth click".
 *
 * Best-effort, matching the open notifier: never throws, never blocks the
 * redirect. Most messages we send have no reside record behind them at all -
 * admin replies, conversation mail - and reside 200s those as unmatched
 * rather than erroring, so an unmatched id is not a failure to log here.
 */
export async function notifyResideMessageClicked(input: {
  messageId: string;
  url: string;
  clickedAt: Date;
  firstClick: boolean;
}): Promise<void> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) return;

  try {
    const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/message-clicked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-comm-canoe-secret": RESIDE_API_SECRET_OUT,
      },
      body: JSON.stringify({
        messageId: input.messageId,
        url: input.url,
        clickedAt: input.clickedAt.toISOString(),
        firstClick: input.firstClick,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[notify-message-clicked] reside call failed (${response.status}): ${await response.text()}`,
      );
    }
  } catch (err) {
    console.error("[notify-message-clicked] reside call threw:", err);
  }
}
