type StoredSession = {
  sessionToken: string;
  conversationId: string;
  expiresAt: number;
};

type ServerMessage =
  | { type: "session"; sessionToken: string; conversationId: string }
  | { type: "message"; text: string; senderType: string }
  | { type: "handoff"; state: string; message?: string }
  | { type: "history"; messages: Array<{ body: string; direction: string; senderType: string }> }
  | { type: "error"; code: string; message?: string };

function storageKey(widgetKey: string) {
  return `canoe-chat:${widgetKey}`;
}

function loadSession(widgetKey: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(storageKey(widgetKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(storageKey(widgetKey));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(widgetKey: string, session: StoredSession) {
  localStorage.setItem(storageKey(widgetKey), JSON.stringify(session));
}

function getWsUrl(): string {
  const script = document.currentScript as HTMLScriptElement | null;
  const fromData = script?.getAttribute("data-bridge-url");
  if (fromData) return fromData.replace(/^http/, "ws") + "/chat";
  return "ws://localhost:3001/chat";
}

function getWidgetKey(): string {
  const script = document.currentScript as HTMLScriptElement | null;
  const key = script?.getAttribute("data-widget-key");
  if (!key) throw new Error("data-widget-key is required");
  return key;
}

class CanoeChatWidget {
  private ws: WebSocket | null = null;
  private widgetKey: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private container: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private panelOpen = false;

  constructor() {
    this.widgetKey = getWidgetKey();
    this.container = this.buildUi();
    document.body.appendChild(this.container);
    this.messagesEl = this.container.querySelector(".canoe-messages")!;
    this.inputEl = this.container.querySelector(".canoe-input") as HTMLInputElement;
    this.connect();
  }

  private buildUi(): HTMLElement {
    const root = document.createElement("div");
    root.className = "canoe-chat-root";
    root.innerHTML = `
      <button type="button" class="canoe-toggle" aria-label="Open chat">Chat</button>
      <div class="canoe-panel" hidden>
        <div class="canoe-header">Chat with us</div>
        <div class="canoe-intro">
          <input class="canoe-name" placeholder="Name (optional)" />
          <input class="canoe-email" type="email" placeholder="Email (optional)" />
          <button type="button" class="canoe-start">Start chat</button>
          <button type="button" class="canoe-skip">Skip — chat anonymously</button>
        </div>
        <div class="canoe-messages"></div>
        <form class="canoe-compose" hidden>
          <input class="canoe-input" placeholder="Type a message…" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      .canoe-chat-root { position: fixed; bottom: 16px; right: 16px; z-index: 99999; font-family: system-ui, sans-serif; }
      .canoe-toggle { background: #18181b; color: #fff; border: none; border-radius: 999px; padding: 12px 18px; cursor: pointer; }
      .canoe-panel { position: absolute; bottom: 48px; right: 0; width: 320px; height: 420px; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,.12); }
      .canoe-header { padding: 12px; font-weight: 600; border-bottom: 1px solid #e4e4e7; }
      .canoe-intro { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .canoe-intro input { padding: 8px; border: 1px solid #d4d4d8; border-radius: 6px; }
      .canoe-intro button { padding: 8px; border-radius: 6px; cursor: pointer; }
      .canoe-skip { background: transparent; border: none; color: #71717a; text-decoration: underline; }
      .canoe-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .canoe-msg { max-width: 85%; padding: 8px 10px; border-radius: 10px; font-size: 14px; line-height: 1.4; }
      .canoe-msg.inbound { align-self: flex-start; background: #f4f4f5; }
      .canoe-msg.outbound { align-self: flex-end; background: #18181b; color: #fff; }
      .canoe-compose { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e4e4e7; }
      .canoe-input { flex: 1; padding: 8px; border: 1px solid #d4d4d8; border-radius: 6px; }
    `;
    document.head.appendChild(style);

    root.querySelector(".canoe-toggle")!.addEventListener("click", () => {
      this.panelOpen = !this.panelOpen;
      const panel = root.querySelector(".canoe-panel") as HTMLElement;
      panel.hidden = !this.panelOpen;
    });

    root.querySelector(".canoe-start")!.addEventListener("click", () => {
      const name = (root.querySelector(".canoe-name") as HTMLInputElement).value.trim();
      const email = (root.querySelector(".canoe-email") as HTMLInputElement).value.trim();
      this.initSession({ name: name || undefined, email: email || undefined });
    });

    root.querySelector(".canoe-skip")!.addEventListener("click", () => {
      this.initSession({ skipAnonymous: true });
    });

    root.querySelector(".canoe-compose")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.inputEl.value.trim();
      if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.appendMessage(text, "outbound");
      this.ws.send(JSON.stringify({ type: "message", text }));
      this.inputEl.value = "";
    });

    return root;
  }

  private initSession(opts: { name?: string; email?: string; skipAnonymous?: boolean }) {
    const intro = this.container.querySelector(".canoe-intro") as HTMLElement;
    const compose = this.container.querySelector(".canoe-compose") as HTMLElement;
    intro.hidden = true;
    compose.hidden = false;

    const stored = loadSession(this.widgetKey);
    this.connect({
      ...opts,
      sessionToken: stored?.sessionToken,
    });
  }

  private connect(init?: {
    name?: string;
    email?: string;
    skipAnonymous?: boolean;
    sessionToken?: string;
  }) {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    this.ws = new WebSocket(getWsUrl());

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.ws!.send(
        JSON.stringify({
          type: "init",
          widgetKey: this.widgetKey,
          sessionToken: init?.sessionToken ?? loadSession(this.widgetKey)?.sessionToken,
          name: init?.name,
          email: init?.email,
          skipAnonymous: init?.skipAnonymous,
        }),
      );
    };

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      this.handleServerMessage(msg);
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const stored = loadSession(this.widgetKey);
      if (stored) this.connect({ sessionToken: stored.sessionToken });
    }, delay);
  }

  private handleServerMessage(msg: ServerMessage) {
    if (msg.type === "session") {
      saveSession(this.widgetKey, {
        sessionToken: msg.sessionToken,
        conversationId: msg.conversationId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      return;
    }

    if (msg.type === "history") {
      this.messagesEl.innerHTML = "";
      for (const m of msg.messages) {
        const dir = m.direction === "inbound" ? "inbound" : "outbound";
        this.appendMessage(m.body, dir === "inbound" ? "inbound" : "outbound");
      }
      return;
    }

    if (msg.type === "message") {
      const dir = msg.senderType === "external" ? "outbound" : "inbound";
      this.appendMessage(msg.text, dir);
      return;
    }

    if (msg.type === "handoff" && msg.message) {
      this.appendMessage(msg.message, "inbound");
      return;
    }

    if (msg.type === "error") {
      if (msg.code === "invalid_session") {
        localStorage.removeItem(storageKey(this.widgetKey));
      }
      this.appendMessage(msg.message ?? msg.code, "inbound");
    }
  }

  private appendMessage(text: string, direction: "inbound" | "outbound") {
    const el = document.createElement("div");
    el.className = `canoe-msg ${direction}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new CanoeChatWidget());
} else {
  new CanoeChatWidget();
}
