import twilio from "twilio";

function parseFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

/**
 * Fallback leg of the live-transfer flow started in
 * apps/realtime-bridge/src/sessions/voice-session.ts's transfer_to_human
 * tool call - Twilio hits this as the `action` URL of the <Dial> verb when
 * a live-transfer dial gets no-answer.
 *
 * Phase 11 fixes two real gaps found during research: this was the only one
 * of the four Twilio webhooks with no signature verification (fixed to
 * match sms/voice/recording-status's pattern), and its "leave a message
 * after the tone" copy didn't actually attach a <Record> verb - no
 * voicemail was ever captured despite the promise. Now records into the
 * same recording-status pipeline every other voicemail uses.
 */
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new Response("Twilio not configured", { status: 503 });
  }

  const rawBody = await request.text();
  const params = parseFormBody(rawBody);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/dial-status`
    : request.url;

  if (!twilio.validateRequest(authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const recordingStatusCallback = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhooks/twilio/recording-status`;

  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    "<Response>" +
    "<Say>Sorry, no one is available. Please leave a message after the tone.</Say>" +
    `<Record maxLength="120" playBeep="true" trim="trim-silence" ` +
    `recordingStatusCallback="${recordingStatusCallback}" recordingStatusCallbackEvent="completed" />` +
    "</Response>";

  return new Response(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
