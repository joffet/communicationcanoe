const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

/**
 * Notifies reside that a conversation's response window has elapsed with no
 * reply, so it can surface a dedicated in-app/push/email notification to the
 * tenant's admins (dispatchToClientAdmins, general.commCanoeResponseOverdue
 * - a separate, independently-configurable event from general.commCanoeActivity,
 * since "overdue" is more urgent than routine activity). Called from
 * overdue-conversation-worker.ts only, once per overdue episode (the caller
 * already claimed the row via claimOverdueConversationNotification before
 * calling this). Best-effort, matches apps/web's identity-status-client.ts/
 * notify-activity.ts pattern exactly: never throws, a failure here should
 * never crash the worker tick. Duplicated here (not shared from apps/web)
 * because this is the first comm-canoe->reside notify call that needs to
 * run from apps/realtime-bridge rather than apps/web - the two apps don't
 * cross-import, and this is a small enough helper that duplicating it beats
 * restructuring packages/messaging's boundary (which is scoped to sending
 * messages to residents, not calling reside's own internal API).
 */
export async function notifyResideResponseOverdue(input: {
  resideClientUid: string;
  conversationId: string;
  summary: string;
}): Promise<void> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) {
    console.error(
      "[notify-response-overdue] RESIDE_API_BASE/COMM_CANOE_API_SECRET not configured, skipping reside notification",
    );
    return;
  }

  try {
    const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/response-overdue`, {
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
      console.error(`[notify-response-overdue] reside call failed (${response.status}): ${await response.text()}`);
    }
  } catch (err) {
    console.error("[notify-response-overdue] reside call threw:", err);
  }
}
