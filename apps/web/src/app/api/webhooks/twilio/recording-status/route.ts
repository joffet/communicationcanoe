import twilio from "twilio";
import { createDomainService } from "@communication-canoe/database";

function parseFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

/**
 * Phase 11: fires after Twilio finishes recording a voicemail (see
 * voice/route.ts's <Record recordingStatusCallback>). Self-contained -
 * re-derives tenant/identity/conversation from Twilio's own params rather
 * than threading state from the answer webhook, matching sms/route.ts's
 * pattern. Creates an empty-body placeholder message
 * (transcription_status: 'pending') that the voicemail-transcription-worker
 * fills in async - this is a fire-and-forget status callback, not a
 * call-control response, so no TwiML is returned.
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
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/recording-status`
    : request.url;

  if (!twilio.validateRequest(authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  // Twilio fires this callback for multiple recording states - only a
  // completed recording is something to transcribe.
  if (params.RecordingStatus !== "completed") {
    return new Response("OK", { status: 200 });
  }

  const from = params.From;
  const to = params.To;
  const recordingUrl = params.RecordingUrl;
  if (!from || !to || !recordingUrl) {
    return new Response("Missing From/To/RecordingUrl", { status: 400 });
  }

  const domain = createDomainService();
  const tenant = await domain.resolveTenantByPhone(to);
  if (!tenant) {
    return new Response("Unknown tenant number", { status: 404 });
  }

  const identity = await domain.findOrCreateIdentity(tenant.id, { phone: from });
  const { conversation } = await domain.findOrCreateConversation(tenant.id, identity.id, {
    channel: "voice",
  });

  // Deliberately not participating in Phase 9's stale-conversation AI-
  // routing check - see the plan's Phase 11 design notes for why (isStale
  // would need to survive across the async gap to transcription completion,
  // which doesn't cleanly exist today; accepted v1 gap, not an oversight).
  await domain.appendMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    channel: "voice",
    direction: "inbound",
    senderType: "external",
    body: "",
    audioUrl: recordingUrl,
    visibility: "external",
    transcriptionStatus: "pending",
  });

  return new Response("OK", { status: 200 });
}
