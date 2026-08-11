const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

/**
 * Notifies reside of new conversation activity so it can surface an
 * in-app/push notification to the tenant's admins (dispatchToClientAdmins,
 * general.commCanoeActivity). Called from Phase 4's member-reply endpoint
 * only - not retroactively wired into the real Twilio/Postmark inbound
 * webhooks, which stays a separate, larger, still-open gap for later.
 * Best-effort, matches identity-status-client.ts's pattern exactly: never
 * throws, a failure here should never block the reply itself from landing.
 */
export async function notifyResideActivity(input: {
  resideClientUid: string;
  conversationId: string;
  summary: string;
}): Promise<void> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) {
    console.error(
      "[notify-activity] RESIDE_API_BASE/COMM_CANOE_API_SECRET not configured, skipping reside notification",
    );
    return;
  }

  try {
    const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-comm-canoe-secret": RESIDE_API_SECRET_OUT,
      },
      body: JSON.stringify({
        resideClientUid: input.resideClientUid,
        conversationId: input.conversationId,
        summary: input.summary,
      }),
    });

    if (!response.ok) {
      console.error(`[notify-activity] reside call failed (${response.status}): ${await response.text()}`);
    }
  } catch (err) {
    console.error("[notify-activity] reside call threw:", err);
  }
}
