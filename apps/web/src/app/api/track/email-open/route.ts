import { createDomainService } from "@communication-canoe/database";
import { verifyEmailOpenToken } from "@communication-canoe/messaging";

// 1x1 transparent GIF, served unconditionally regardless of token validity -
// no information leak on an invalid/expired/tampered token.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64",
);

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const payload = token ? verifyEmailOpenToken(token) : null;

  if (payload) {
    try {
      await createDomainService().markMessageOpened(payload.messageId);
    } catch (err) {
      console.error("[track/email-open] failed to record open:", err);
    }
  }

  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });
}
