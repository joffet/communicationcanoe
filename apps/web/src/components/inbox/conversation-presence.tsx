"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";

type PresenceUser = { userId: string; name: string };

export function ConversationPresence({ conversationId }: { conversationId: string }) {
  const [viewers, setViewers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let userId = "";
    let displayName = "Agent";

    void supabase.auth.getUser().then(({ data }) => {
      userId = data.user?.id ?? crypto.randomUUID();
      displayName = data.user?.email?.split("@")[0] ?? "Agent";
    });

    const channel = supabase.channel(`presence:conversation:${conversationId}`, {
      config: { presence: { key: userId || "anon" } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        const all = Object.values(state).flat();
        setViewers(all.filter((v) => v.userId !== userId));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          const { data } = await supabase.auth.getUser();
          const uid = data.user?.id ?? crypto.randomUUID();
          await channel.track({
            userId: uid,
            name: data.user?.email?.split("@")[0] ?? "Agent",
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

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
