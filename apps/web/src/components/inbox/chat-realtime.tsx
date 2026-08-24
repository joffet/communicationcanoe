"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeToDashboard } from "@/lib/realtime/dashboard-socket";

/** Conversation id -> the AI's reason for escalating, or null until the fetch
 * below lands (or if the transfer carries no reason). */
export function useNeedsHumanConversations(tenantId: string) {
  const [needsHuman, setNeedsHuman] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    const { unsubscribe } = subscribeToDashboard(tenantId, (event) => {
      if (event.type !== "needs_human") return;
      const { conversationId } = event;
      setNeedsHuman((prev) => new Map(prev).set(conversationId, null));

      // The reason is not in the payload - the socket carries signals, not
      // content - so it comes from the tenant-scoped route instead.
      void (async () => {
        const res = await fetch(`/api/conversations/${conversationId}/transfer-reason`);
        if (!res.ok) return;
        const body = (await res.json()) as { reason: string | null };
        if (!body.reason) return;
        setNeedsHuman((prev) =>
          prev.has(conversationId)
            ? new Map(prev).set(conversationId, body.reason)
            : prev,
        );
      })();
    });

    return unsubscribe;
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

/**
 * Refetches the open conversation whenever the bridge says it changed.
 *
 * This is also what registers the agent as a viewer of it: the `watch` below
 * is the single place the socket is told which conversation is open, and
 * ConversationPresence reads the viewer lists that follow from it. So this
 * hook stays mounted for the whole inbox, including while `conversationId` is
 * null - it is what says "none open" too.
 */
export function useConversationRealtime(
  tenantId: string,
  conversationId: string | null,
  onMessage: () => void,
) {
  // Read through a ref so the subscription below does not depend on either:
  // selecting a conversation would otherwise tear the socket down and open a
  // new one - new token, new handshake - on every click in the list.
  const current = useRef({ conversationId, onMessage });
  const watchRef = useRef<((id: string | null) => void) | null>(null);

  useEffect(() => {
    current.current = { conversationId, onMessage };
  }, [conversationId, onMessage]);

  useEffect(() => {
    const { unsubscribe, watch } = subscribeToDashboard(tenantId, (event) => {
      const open = current.current;
      if (event.type === "conversation" && event.conversationId === open.conversationId) {
        open.onMessage();
        return;
      }
      // Reconnected: whatever arrived while the socket was down was never
      // delivered, and a refetch is cheaper than reasoning about what it was.
      if (event.type === "resumed") open.onMessage();
    });

    watchRef.current = watch;
    watch(current.current.conversationId);

    return () => {
      watch(null);
      watchRef.current = null;
      unsubscribe();
    };
  }, [tenantId]);

  useEffect(() => {
    watchRef.current?.(conversationId);
  }, [conversationId]);
}
