"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { createRealtimeClient } from "@/lib/supabase/realtime";
import { Avatar } from "@/components/ui/avatar";

type PresenceUser = { userId: string; name: string };

export function ConversationPresence({ conversationId }: { conversationId: string }) {
  const { data: session } = authClient.useSession();
  const [viewers, setViewers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const displayName = session.user.name ?? session.user.email?.split("@")[0] ?? "Agent";
    const supabase = createRealtimeClient();

    const channel = supabase.channel(`presence:conversation:${conversationId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        const all = Object.values(state).flat();
        setViewers(all.filter((v) => v.userId !== userId));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId, name: displayName });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, session?.user?.email, session?.user?.id, session?.user?.name]);

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
