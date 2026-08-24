import type { DashboardConversationEvent } from "@communication-canoe/shared/realtime";

/**
 * Fan-out for conversation changes made through the domain service rather than
 * through a live chat session.
 *
 * The dashboard's socket is served by realtime-bridge, so this posts to that
 * service instead of holding a subscriber list of its own. Both callers reach
 * it over HTTP, including the bridge itself when one of its own workers merges
 * a conversation - a loopback request is a small price for having one path
 * instead of two, and this package cannot import the bridge's hub without
 * inverting the app/package dependency.
 *
 * Best-effort on purpose: a merge that succeeded must not be reported as
 * failed because a notification did not land. The worst case is a dashboard
 * that refetches on its next navigation instead of immediately.
 */
export async function notifyDashboardConversation(
  conversationId: string,
  event: DashboardConversationEvent,
): Promise<void> {
  const base =
    process.env.REALTIME_BRIDGE_URL ??
    process.env.VOICE_BRIDGE_URL ??
    "http://localhost:3001";

  try {
    await fetch(`${base}/internal/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({ conversationId, event }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn(
      `[realtime] conversation ${event} notification failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
