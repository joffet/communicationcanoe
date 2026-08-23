"use client";

import { useEffect, useState } from "react";
import { createRealtimeClient } from "@/lib/supabase/realtime";

/** Conversation id -> the AI's reason for escalating, or null until the fetch
 * below lands (or if the transfer carries no reason). */
export function useNeedsHumanConversations(tenantId: string) {
  const [needsHuman, setNeedsHuman] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    const supabase = createRealtimeClient();
    const channel = supabase
      .channel(`chat:tenant:${tenantId}`)
      .on("broadcast", { event: "needs_human" }, (payload) => {
        const data = payload.payload as ChatBroadcastNeedsHuman;
        setNeedsHuman((prev) => new Map(prev).set(data.conversationId, null));

        // The reason is not in the payload on purpose - this channel is
        // public - so it comes from the tenant-scoped route instead.
        void (async () => {
          const res = await fetch(
            `/api/conversations/${data.conversationId}/transfer-reason`,
          );
          if (!res.ok) return;
          const body = (await res.json()) as { reason: string | null };
          if (!body.reason) return;
          setNeedsHuman((prev) =>
            prev.has(data.conversationId)
              ? new Map(prev).set(data.conversationId, body.reason)
              : prev,
          );
        })();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  function clearNeedsHuman(conversationId: string) {
    setNeedsHuman((prev) => {
      const next = new Map(prev);
      next.delete(conversationId);
      return next;
    });
  }

  return { needsHuman, clearNeedsHuman };
}

export function useConversationRealtime(
  conversationId: string | null,
  onMessage: () => void,
) {
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createRealtimeClient();
    const channel = supabase
      .channel(`chat:conversation:${conversationId}`)
      .on("broadcast", { event: "message" }, () => {
        onMessage();
      })
      .on("broadcast", { event: "handoff_state" }, () => {
        onMessage();
      })
      // Phase 8: emitted by DomainService.splitConversation/mergeConversations
      // (packages/database) whenever a conversation is restructured by a raw
      // UPDATE that bypasses appendMessage's own "message" broadcast - a
      // generic "refetch this conversation" signal, not shaped like a chat
      // message, since split/merge can affect any channel.
      .on("broadcast", { event: "updated" }, () => {
        onMessage();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, onMessage]);
}
