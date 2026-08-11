const RESIDE_API_BASE = process.env.RESIDE_API_BASE;
const RESIDE_API_SECRET_OUT = process.env.COMM_CANOE_API_SECRET;

/**
 * Notifies reside that a resident's email or SMS channel has crossed the
 * consecutive-failure threshold ("undeliverable") or recovered after being
 * flagged ("deliverable"), so it can set/clear the flag on the resident
 * record. Best-effort - a failure here should never block delivery-status
 * webhook processing (the counter/flag in comm-canoe's own `identities`
 * table is already durable regardless of whether this call succeeds).
 */
export async function notifyResideIdentityStatus(input: {
  resideClientUid: string;
  resideResidentId: string;
  channel: "email" | "sms";
  status: "undeliverable" | "deliverable";
}): Promise<void> {
  if (!RESIDE_API_BASE || !RESIDE_API_SECRET_OUT) {
    console.error(
      "[identity-status] RESIDE_API_BASE/COMM_CANOE_API_SECRET not configured, skipping reside notification",
    );
    return;
  }

  try {
    const response = await fetch(`${RESIDE_API_BASE}/api/internal/comm-canoe/identity-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-comm-canoe-secret": RESIDE_API_SECRET_OUT,
      },
      body: JSON.stringify({
        resideClientUid: input.resideClientUid,
        resideResidentId: input.resideResidentId,
        channel: input.channel,
        status: input.status,
      }),
    });

    if (!response.ok) {
      console.error(`[identity-status] reside call failed (${response.status}): ${await response.text()}`);
    }
  } catch (err) {
    console.error("[identity-status] reside call threw:", err);
  }
}
