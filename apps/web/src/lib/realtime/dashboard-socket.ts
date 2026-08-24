import type { DashboardServerMessage } from "@communication-canoe/shared/realtime";

/**
 * `resumed` is the client's own, not the bridge's: a socket that dropped and
 * came back missed whatever happened while it was gone, and a listener that
 * refetches on it is back in sync without anyone tracking what was missed.
 */
export type DashboardSocketEvent = DashboardServerMessage | { type: "resumed" };

type Listener = (event: DashboardSocketEvent) => void;

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

/**
 * The dashboard's single connection to realtime-bridge.
 *
 * One socket per tenant, shared by everything on the page that cares - live
 * conversation updates, the "needs human" list, the presence avatars - because
 * they are all facets of the same subscription and a socket each would mean a
 * token each and three presence entries per agent.
 *
 * Reference counted rather than left open: the inbox is one route in a larger
 * app, and a socket that outlives it holds a viewer entry that never clears.
 */
class DashboardSocket {
  readonly #tenantId: string;
  readonly #listeners = new Set<Listener>();
  #ws: WebSocket | null = null;
  #watching: string | null = null;
  #authed = false;
  #hadSession = false;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;

  constructor(tenantId: string) {
    this.#tenantId = tenantId;
    void this.#connect();
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  /** The conversation the agent has open, or null. Sent on connect too, so a
   * reconnect lands back on the same conversation without the caller
   * re-asking. */
  watch(conversationId: string | null) {
    if (this.#watching === conversationId) return;
    this.#watching = conversationId;
    this.#sendWatch();
  }

  close() {
    this.#closed = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#ws?.close();
    this.#ws = null;
    this.#listeners.clear();
  }

  async #connect() {
    if (this.#closed) return;

    let token: string;
    let url: string;
    try {
      const res = await fetch(
        `/api/realtime/token?tenantId=${encodeURIComponent(this.#tenantId)}`,
      );
      if (!res.ok) throw new Error(`token request failed: ${res.status}`);
      ({ token, url } = (await res.json()) as { token: string; url: string });
    } catch {
      this.#scheduleRetry();
      return;
    }

    if (this.#closed) return;

    const ws = new WebSocket(url);
    this.#ws = ws;
    this.#authed = false;

    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));

    ws.onmessage = (event) => {
      let msg: DashboardServerMessage;
      try {
        msg = JSON.parse(event.data as string) as DashboardServerMessage;
      } catch {
        return;
      }

      if (msg.type === "ready") {
        this.#authed = true;
        this.#attempt = 0;
        this.#sendWatch();
        if (this.#hadSession) this.#emit({ type: "resumed" });
        this.#hadSession = true;
        return;
      }

      this.#emit(msg);
    };

    ws.onclose = () => {
      if (this.#ws === ws) this.#ws = null;
      this.#authed = false;
      this.#scheduleRetry();
    };

    // The close handler runs after this and owns the retry.
    ws.onerror = () => ws.close();
  }

  #sendWatch() {
    if (!this.#authed || this.#ws?.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify({ type: "watch", conversationId: this.#watching }));
  }

  #scheduleRetry() {
    if (this.#closed || this.#retryTimer) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.#attempt, RETRY_DELAYS_MS.length - 1)];
    this.#attempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#connect();
    }, delay);
  }

  #emit(event: DashboardSocketEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

const sockets = new Map<string, DashboardSocket>();

/**
 * Subscribe to the tenant's dashboard socket, opening it if this is the first
 * caller and closing it when the last one leaves.
 */
export function subscribeToDashboard(
  tenantId: string,
  listener: (event: DashboardSocketEvent) => void,
): { unsubscribe: () => void; watch: (conversationId: string | null) => void } {
  let socket = sockets.get(tenantId);
  if (!socket) sockets.set(tenantId, (socket = new DashboardSocket(tenantId)));

  const owned = socket;
  const unsubscribe = owned.subscribe(listener);

  return {
    watch: (conversationId) => owned.watch(conversationId),
    unsubscribe: () => {
      unsubscribe();
      if (owned.listenerCount === 0) {
        owned.close();
        if (sockets.get(tenantId) === owned) sockets.delete(tenantId);
      }
    },
  };
}
