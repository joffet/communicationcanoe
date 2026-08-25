import { createDomainService } from "@communication-canoe/database";
import { verifyEmailClickToken, type EmailClickTokenPayload } from "@communication-canoe/messaging";
import { notifyResideMessageClicked } from "@/lib/reside/notify-message-clicked";

/**
 * Records a click on a tracked link, by either of the two mechanisms
 * withClickTracking chooses between.
 *
 * `GET` is the redirector, for links to somewhere we do not own: the reader
 * arrives here and is sent on. `POST` is the reporter, for links to the
 * tenant's own reside host, which keep their real URL and carry the token as
 * a query parameter - reside's landing page beacons it here after the page
 * has already loaded. Same token, same recording, different carrier.
 *
 * The destination comes out of the verified token in both cases, never off
 * the query string and never from whatever the reporting page claims it is.
 * There is no `&u=` parameter to tamper with, so this cannot be turned into an
 * open redirect by anyone who receives one of these links - which, for a
 * building notice, is everyone in the building.
 *
 * A bad, expired or tampered token gets a 404 rather than a redirect
 * anywhere. There is no safe default destination: sending them to the app's
 * home page would mean a forged link still moves somebody somewhere, and the
 * token is the only thing that says where they were meant to go.
 *
 * Recording never blocks the reader. A click that cannot be written down is a
 * statistic nobody gets; a reader stranded on an error page because of it is
 * the notice failing at the only thing it was for.
 */
async function record(payload: EmailClickTokenPayload): Promise<void> {
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
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const payload = token ? verifyEmailClickToken(token) : null;

  if (!payload) {
    return new Response("Not found", { status: 404 });
  }

  await record(payload);

  return Response.redirect(payload.url, 302);
}

/**
 * Called server-side by reside, forwarding a token its landing page beaconed.
 *
 * Unauthenticated on purpose, like the GET above: the token is the credential,
 * and it is the only thing here that proves the caller holds a link this
 * service minted. A secret would add nothing a forged token could not already
 * defeat, and would have to be shared with a route reside exposes to browsers.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { t?: unknown } | null;
  const token = typeof body?.t === "string" ? body.t : null;
  const payload = token ? verifyEmailClickToken(token) : null;

  if (!payload) {
    return new Response("Not found", { status: 404 });
  }

  await record(payload);

  return new Response(null, { status: 204 });
}
