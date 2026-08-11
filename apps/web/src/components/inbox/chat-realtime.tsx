"use client";

import { useEffect, useState } from "react";
import { createRealtimeClient } from "@/lib/supabase/realtime";

export function useNeedsHumanConversations(tenantId: string) {
  const [needsHuman, setNeedsHuman] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createRealtimeClient();
    const channel = supabase
      .channel(`chat:tenant:${tenantId}`)
      .on("broadcast", { event: "needs_human" }, (payload) => {
        const data = payload.payload as ChatBroadcastNeedsHuman;
        setNeedsHuman((prev) => new Set(prev).add(data.conversationId));
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  function clearNeedsHuman(conversationId: string) {
    setNeedsHuman((prev) => {
      const next = new Set(prev);
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
