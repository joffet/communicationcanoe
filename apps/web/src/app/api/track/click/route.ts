import { createDomainService } from "@communication-canoe/database";
import { verifyEmailClickToken } from "@communication-canoe/messaging";
import { notifyResideMessageClicked } from "@/lib/reside/notify-message-clicked";

/**
 * Records a click on a tracked link and sends the reader on.
 *
 * The destination comes out of the verified token, never off the query
 * string. There is no `&u=` parameter to tamper with, so this cannot be
 * turned into an open redirect by anyone who receives one of these links -
 * which, for a building notice, is everyone in the building.
 *
 * A bad, expired or tampered token gets a 404 rather than a redirect
 * anywhere. There is no safe default destination: sending them to the app's
 * home page would mean a forged link still moves somebody somewhere, and the
 * token is the only thing that says where they were meant to go.
 *
 * Recording never blocks the redirect. A click that cannot be written down is
 * a statistic nobody gets; a reader stranded on an error page because of it is
 * the notice failing at the only thing it was for.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const payload = token ? verifyEmailClickToken(token) : null;

  if (!payload) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const { firstClick } = await createDomainService().recordMessageClick(payload.messageId);
    // Every click, not only the first - unlike the open pixel, which is
    // re-fetched by image proxies and so is notified once. A click is a person
    // choosing to go somewhere, and a notice with two buttons wants to know
    // which one got pressed and how often.
    await notifyResideMessageClicked({
      messageId: payload.messageId,
      url: payload.url,
      clickedAt: new Date(),
      firstClick,
    });
  } catch (err) {
    console.error("[track/click] failed to record click:", err);
  }

  return Response.redirect(payload.url, 302);
}
