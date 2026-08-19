import twilio from "twilio";
import { createDomainService } from "@communication-canoe/database";
import { escapeHtml } from "@/lib/email/templates/escape-html";

const DEFAULT_GREETING =
  "You've reached the property management office. Please leave a message after the tone.";

function parseFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

/**
 * Phase 11: the inbound-call-answering webhook that didn't exist anywhere
 * before this phase - every call goes straight to voicemail (see the plan's
 * scope decision: this deliberately does not attempt the existing live-AI-
 * agent bridge at /stream). Returns TwiML only, no DB writes - the actual
 * message row is created by recording-status/route.ts once a recording
 * completes.
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
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/voice`
    : request.url;

  if (!twilio.validateRequest(authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const to = params.To;
  const domain = createDomainService();
  const tenant = to ? await domain.resolveTenantByPhone(to) : null;

  // An unknown/unprovisioned number is an edge case, not the normal path -
  // Twilio expects TwiML back for call control either way, not an HTTP error.
  let greeting = DEFAULT_GREETING;
  if (tenant) {
    const settings = await domain.getTenantSettings(tenant.id);
    if (settings?.greetingMessage) {
      greeting = settings.greetingMessage;
    }
  }

  const recordingStatusCallback = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhooks/twilio/recording-status`;

  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    "<Response>" +
    `<Say>${escapeHtml(greeting)}</Say>` +
    `<Record maxLength="120" playBeep="true" trim="trim-silence" ` +
    `recordingStatusCallback="${escapeHtml(recordingStatusCallback)}" recordingStatusCallbackEvent="completed" />` +
    "<Say>We did not receive a recording. Goodbye.</Say>" +
    "</Response>";

  return new Response(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
