"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationPresence } from "@/components/inbox/conversation-presence";
import {
  useConversationRealtime,
  useNeedsHumanConversations,
} from "@/components/inbox/chat-realtime";
import { cn, formatRelativeTime } from "@/lib/utils";

function senderLabel(senderType: string) {
  if (senderType === "ai_agent") return "AI";
  if (senderType === "internal_user") return "Agent";
  return "Customer";
}

export function InboxShell({
  tenantId,
  conversations: initialConversations,
  selectedId,
  thread: initialThread,
  currentUserId,
}: {
  tenantId: string;
  conversations: ConversationWithIdentity[];
  selectedId: string | null;
  thread: ConversationThread | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [thread, setThread] = useState(initialThread);
  const [draft, setDraft] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [joining, setJoining] = useState(false);
  const { needsHuman, clearNeedsHuman } = useNeedsHumanConversations(tenantId);

  const refreshThread = useCallback(() => {
    router.refresh();
  }, [router]);

  useConversationRealtime(selectedId, refreshThread);

  useEffect(() => {
    setConversations(initialConversations);
    setThread(initialThread);
  }, [initialConversations, initialThread]);

  const isWebChat = thread?.messages.some((m) => m.channel === "web_chat");
  const isAssignedToMe = thread?.assigned_user_id === currentUserId;
  const needsHumanNow = selectedId ? needsHuman.has(selectedId) : false;

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

  async function joinChat() {
    if (!selectedId) return;
    setJoining(true);
    try {
      await fetch(`/api/conversations/${selectedId}/join-chat`, { method: "POST" });
      clearNeedsHuman(selectedId);
      router.refresh();
    } finally {
      setJoining(false);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !composeText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: composeText.trim() }),
      });
      if (res.ok) {
        setComposeText("");
        router.refresh();
      }
    } finally {
      setSending(false);
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
              const label =
                c.identity.name ??
                c.identity.phone ??
                c.identity.email ??
                (c.identity.is_anonymous ? "Anonymous visitor" : "Unknown");
              const live = needsHuman.has(c.id);
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
                      <div className="flex shrink-0 items-center gap-2">
                        {live && (
                          <span className="h-2 w-2 rounded-full bg-red-500" title="Needs human" />
                        )}
                        <span className="text-xs text-zinc-400">
                          {formatRelativeTime(c.last_message_at)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline">{c.status}</Badge>
                      {live && <Badge variant="secondary">Live chat</Badge>}
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
                    {thread.identity.name ??
                      thread.identity.phone ??
                      thread.identity.email ??
                      (thread.identity.is_anonymous ? "Anonymous visitor" : "Unknown")}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {[thread.identity.phone, thread.identity.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ConversationPresence conversationId={thread.id} />
                {isWebChat && needsHumanNow && !isAssignedToMe && (
                  <Button size="sm" onClick={joinChat} disabled={joining}>
                    {joining ? "Joining…" : "Join chat"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={summarize} disabled={summaryLoading}>
                  {summaryLoading ? "Summarizing…" : "Summarize"}
                </Button>
                <Button variant="outline" size="sm" onClick={loadSuggestion} disabled={suggestLoading}>
                  {suggestLoading ? "Loading…" : "Suggest reply"}
                </Button>
              </div>
            </header>

            {needsHumanNow && (
              <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                Live chat — human needed
              </div>
            )}

            {isWebChat && isAssignedToMe && (
              <div className="border-b border-green-200 bg-green-50 px-6 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
                You are handling this live chat
              </div>
            )}

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
                      <span>{senderLabel(m.sender_type)}</span>
                      <span>{formatRelativeTime(m.created_at)}</span>
                    </div>
                    {m.subject && <p className="mb-1 font-medium">{m.subject}</p>}
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {isWebChat && (isAssignedToMe || needsHumanNow) && (
              <form
                onSubmit={(e) => void sendMessage(e)}
                className="flex gap-2 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800"
              >
                <textarea
                  className="min-h-[44px] flex-1 resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  placeholder={
                    isAssignedToMe ? "Reply to visitor…" : "Join chat to reply…"
                  }
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  disabled={!isAssignedToMe || sending}
                />
                <Button type="submit" disabled={!isAssignedToMe || sending || !composeText.trim()}>
                  {sending ? "Sending…" : "Send"}
                </Button>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  );
}
