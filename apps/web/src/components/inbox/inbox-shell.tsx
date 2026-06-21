"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ConversationThread, ConversationWithIdentity } from "@communication-canoe/database";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationPresence } from "@/components/inbox/conversation-presence";
import { cn, formatRelativeTime } from "@/lib/utils";

export function InboxShell({
  tenantId,
  conversations: initialConversations,
  selectedId,
  thread: initialThread,
}: {
  tenantId: string;
  conversations: ConversationWithIdentity[];
  selectedId: string | null;
  thread: ConversationThread | null;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [thread, setThread] = useState(initialThread);
  const [draft, setDraft] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  useEffect(() => {
    setConversations(initialConversations);
    setThread(initialThread);
  }, [initialConversations, initialThread]);

  // Poll for updates — postgres_changes requires Supabase Auth JWT; Better Auth uses app-layer refresh instead.
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 15_000);
    return () => clearInterval(interval);
  }, [router]);

  async function loadSuggestion() {
    if (!selectedId) return;
    setSuggestLoading(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/suggest-reply`);
      const data = (await res.json()) as { draft?: string };
      setDraft(data.draft ?? null);
    } finally {
      setSuggestLoading(false);
    }
  }

  async function summarize() {
    if (!selectedId) return;
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/summarize`, { method: "POST" });
      const data = (await res.json()) as { summary?: string };
      if (data.summary) {
        setThread((prev) => (prev ? { ...prev, summary: data.summary ?? null } : prev));
      }
    } finally {
      setSummaryLoading(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-96 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h1 className="font-semibold">Inbox</h1>
          <p className="text-xs text-zinc-500">{conversations.length} conversations</p>
        </div>
        <ScrollArea className="flex-1">
          <ul>
            {conversations.map((c) => {
              const label = c.identity.name ?? c.identity.phone ?? c.identity.email ?? "Unknown";
              return (
                <li key={c.id}>
                  <Link
                    href={`/inbox?c=${c.id}`}
                    className={cn(
                      "block border-b border-zinc-100 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50",
                      selectedId === c.id && "bg-zinc-100 dark:bg-zinc-800",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{label}</span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {formatRelativeTime(c.last_message_at)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline">{c.status}</Badge>
                      {c.summary && (
                        <span className="truncate text-xs text-zinc-500">{c.summary}</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        {!thread ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Select a conversation
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <Avatar name={thread.identity.name} />
                <div>
                  <h2 className="font-semibold">
                    {thread.identity.name ?? thread.identity.phone ?? thread.identity.email}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {[thread.identity.phone, thread.identity.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ConversationPresence conversationId={thread.id} />
                <Button variant="outline" size="sm" onClick={summarize} disabled={summaryLoading}>
                  {summaryLoading ? "Summarizing…" : "Summarize"}
                </Button>
                <Button variant="outline" size="sm" onClick={loadSuggestion} disabled={suggestLoading}>
                  {suggestLoading ? "Loading…" : "Suggest reply"}
                </Button>
              </div>
            </header>

            {thread.summary && (
              <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                <span className="font-medium">Summary: </span>
                {thread.summary}
              </div>
            )}

            {draft && (
              <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                <span className="font-medium">Suggested reply: </span>
                {draft}
              </div>
            )}

            <ScrollArea className="flex-1 px-6 py-4">
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                      m.direction === "inbound"
                        ? "self-start bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
                        : "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                      <Badge variant="secondary">{m.channel}</Badge>
                      <span>{formatRelativeTime(m.created_at)}</span>
                    </div>
                    {m.subject && <p className="mb-1 font-medium">{m.subject}</p>}
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </section>
    </div>
  );
}
