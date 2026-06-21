import type { ChatSession } from "./chat-session.js";
import type { VoiceSession } from "./voice-session.js";

class SessionManager {
  private chatSessions = new Map<string, ChatSession>();
  private voiceSessions = new Map<string, VoiceSession>();

  registerChat(session: ChatSession) {
    this.chatSessions.set(session.conversationId, session);
  }

  unregisterChat(conversationId: string) {
    this.chatSessions.delete(conversationId);
  }

  getChat(conversationId: string): ChatSession | undefined {
    return this.chatSessions.get(conversationId);
  }

  registerVoice(callSid: string, session: VoiceSession) {
    this.voiceSessions.set(callSid, session);
  }

  unregisterVoice(callSid: string) {
    this.voiceSessions.delete(callSid);
  }

  getVoice(callSid: string): VoiceSession | undefined {
    return this.voiceSessions.get(callSid);
  }
}

export const sessionManager = new SessionManager();
