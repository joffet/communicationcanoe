const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

const RETRY_DELAYS_MS = [500, 2_000, 8_000];

export type ResideVoicemailNotice = {
  resideClientUid: string;
  from: string;
  to: string;
  recordingUrl: string;
  transcript: string | null;
  durationSeconds?: number;
  /** A stable id for this voicemail - reside dedupes retries on it. */
  callSid: string;
};

/**
 * Hands a voicemail to reside once it is transcribed (or once transcription
 * gave up), so it lands in the caller's conversation in reside's inbox - the
 * conversation lives there, not here (reside's docs/inbox-overhaul-plan.md,
 * comm-canoe change 2). Same shape as notify-response-overdue.ts, plus a
 * retry on 5xx and network failure: reside answers inside its webhook budget,
 * so a 5xx is a deploy or a database hiccup, not a bad request. A 4xx is
 * final - reside refused the payload or the tenant, and sending it again
 * changes nothing. Never throws into the worker.
 */
export async function notifyResideVoicemail(input: ResideVoicemailNotice): Promise<boolean> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) {
    console.error("[notify-voicemail] RESIDE_API_BASE/COMM_CANOE_API_SECRET not configured, skipping reside notification");
    return false;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/voicemail`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-comm-canoe-secret": RESIDE_API_SECRET_OUT },
        body: JSON.stringify(input),
      });
      if (response.ok) return true;
      const text = await response.text();
      if (response.status < 500 || attempt >= RETRY_DELAYS_MS.length) {
        console.error(`[notify-voicemail] reside call failed (${response.status}): ${text}`);
        return false;
      }
      console.warn(`[notify-voicemail] reside answered ${response.status}; retrying`);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.error("[notify-voicemail] reside call threw:", err);
        return false;
      }
      console.warn("[notify-voicemail] reside call threw; retrying:", err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
