import { createClient } from "@supabase/supabase-js";
import type {
  ChatBroadcastHandoffState,
  ChatBroadcastMessage,
  ChatBroadcastNeedsHuman,
  ChatBroadcastTyping,
} from "@communication-canoe/shared/realtime";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for Realtime broadcasts");
  }
  return createClient(url, key);
}

export async function broadcastNeedsHuman(
  tenantId: string,
  payload: ChatBroadcastNeedsHuman,
) {
  const supabase = getClient();
  const channel = supabase.channel(`chat:tenant:${tenantId}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "needs_human", payload });
  await supabase.removeChannel(channel);
}

export async function broadcastHandoffState(
  conversationId: string,
  payload: ChatBroadcastHandoffState,
) {
  const supabase = getClient();
  const channel = supabase.channel(`chat:conversation:${conversationId}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "handoff_state", payload });
  await supabase.removeChannel(channel);
}

export async function broadcastChatMessage(
  conversationId: string,
  payload: ChatBroadcastMessage,
) {
  const supabase = getClient();
  const channel = supabase.channel(`chat:conversation:${conversationId}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "message", payload });
  await supabase.removeChannel(channel);
}

export async function broadcastTyping(
  conversationId: string,
  payload: ChatBroadcastTyping,
) {
  const supabase = getClient();
  const channel = supabase.channel(`chat:conversation:${conversationId}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "typing", payload });
  await supabase.removeChannel(channel);
}
