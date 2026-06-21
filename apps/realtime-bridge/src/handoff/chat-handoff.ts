import type { ChatSession } from "../sessions/chat-session.js";

export async function handleChatTransfer(session: ChatSession, reason: string) {
  await session.beginHandoff(reason);
}
