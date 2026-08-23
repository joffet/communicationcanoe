import { createClient } from "@supabase/supabase-js";
import type { ChatBroadcastNeedsHuman } from "@communication-canoe/shared/realtime";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for Realtime broadcasts");
  }
  return createClient(url, key);
}

/**
 * These channels are public: subscribing needs only the anon key and the topic
 * string, and Supabase cannot authorize them for us because the tables that
 * would decide (conversations, user_tenant_memberships) are in PlanetScale.
 * So nothing here sends content - see the note on the payload types in
 * @communication-canoe/shared/realtime. Each of these is a nudge telling the
 * dashboard to refetch through the authenticated route.
 */
async function emit(topic: string, event: string, payload: object) {
  const supabase = getClient();
  const channel = supabase.channel(topic);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event, payload });
  await supabase.removeChannel(channel);
}

export async function broadcastNeedsHuman(
  tenantId: string,
  payload: ChatBroadcastNeedsHuman,
) {
  await emit(`chat:tenant:${tenantId}`, "needs_human", payload);
}

export async function broadcastHandoffState(conversationId: string) {
  await emit(`chat:conversation:${conversationId}`, "handoff_state", {});
}

export async function broadcastChatMessage(conversationId: string) {
  await emit(`chat:conversation:${conversationId}`, "message", {});
}
