"use client";

import { useEffect, useState } from "react";
import type { DashboardViewer } from "@communication-canoe/shared/realtime";
import { subscribeToDashboard } from "@/lib/realtime/dashboard-socket";
import { Avatar } from "@/components/ui/avatar";

/**
 * Who else has this conversation open.
 *
 * Listens only - the bridge learns this agent is viewing from the `watch` that
 * useConversationRealtime already sends for the same conversation, and derives
 * every viewer's identity from the token on the socket rather than from
 * anything the browser claims. The list arrives excluding this agent.
 */
export function ConversationPresence({
  tenantId,
  conversationId,
}: {
  tenantId: string;
  conversationId: string;
}) {
  // Kept with the conversation it describes rather than reset when that
  // changes: a viewer list for the conversation just closed is simply not this
  // conversation's list, and comparing on render says so without a second
  // state update chasing the first.
  const [latest, setLatest] = useState<{
    conversationId: string;
    viewers: DashboardViewer[];
  } | null>(null);

  useEffect(() => {
    const { unsubscribe } = subscribeToDashboard(tenantId, (event) => {
      if (event.type !== "viewers") return;
      setLatest({ conversationId: event.conversationId, viewers: event.viewers });
    });

    return unsubscribe;
  }, [tenantId]);

  const viewers = latest?.conversationId === conversationId ? latest.viewers : [];

  if (viewers.length === 0) return null;

  return (
    <div className="flex items-center gap-1" title="Also viewing">
      {viewers.slice(0, 3).map((v) => (
        <Avatar key={v.userId} name={v.name} className="h-6 w-6 text-[10px]" />
      ))}
      {viewers.length > 3 && (
        <span className="text-xs text-zinc-500">+{viewers.length - 3}</span>
      )}
    </div>
  );
}
