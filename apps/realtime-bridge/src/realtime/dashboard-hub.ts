import type {
  DashboardConversationEvent,
  DashboardServerMessage,
  DashboardViewer,
} from "@communication-canoe/shared/realtime";
import type { TenantId } from "@communication-canoe/database";

export type DashboardClient = {
  tenantId: TenantId;
  userId: string;
  name: string;
  /** The conversation this client has open, or null between selections. */
  watching: string | null;
  send: (msg: DashboardServerMessage) => void;
};

/**
 * Every connected dashboard socket, indexed by what it needs to be found by.
 *
 * In-memory, single-process, exactly like sessionManager next door - the bridge
 * already assumes one instance (a chat session lives in the process that holds
 * the visitor's socket, and `/internal/agent-message` only reaches it there),
 * so a second replica would break more than this. Scaling out means putting a
 * shared bus behind both, not just this one.
 */
class DashboardHub {
  readonly #clients = new Set<DashboardClient>();
  readonly #byTenant = new Map<TenantId, Set<DashboardClient>>();
  readonly #byConversation = new Map<string, Set<DashboardClient>>();

  add(client: DashboardClient) {
    this.#clients.add(client);
    let tenantSet = this.#byTenant.get(client.tenantId);
    if (!tenantSet) this.#byTenant.set(client.tenantId, (tenantSet = new Set()));
    tenantSet.add(client);
  }

  remove(client: DashboardClient) {
    this.#clients.delete(client);

    const tenantSet = this.#byTenant.get(client.tenantId);
    tenantSet?.delete(client);
    if (tenantSet?.size === 0) this.#byTenant.delete(client.tenantId);

    const left = client.watching;
    this.#stopWatching(client);
    if (left) this.#publishViewers(left);
  }

  /**
   * Point a client at a conversation, or at none. Both the old and the new
   * conversation get a fresh viewer list, since the client left one and joined
   * the other in the same move.
   */
  watch(client: DashboardClient, conversationId: string | null) {
    const previous = client.watching;
    if (previous === conversationId) return;

    this.#stopWatching(client);
    client.watching = conversationId;

    if (conversationId) {
      let watchers = this.#byConversation.get(conversationId);
      if (!watchers) this.#byConversation.set(conversationId, (watchers = new Set()));
      watchers.add(client);
    }

    if (previous) this.#publishViewers(previous);
    if (conversationId) this.#publishViewers(conversationId);
  }

  emitNeedsHuman(tenantId: TenantId, conversationId: string) {
    for (const client of this.#byTenant.get(tenantId) ?? []) {
      client.send({ type: "needs_human", conversationId });
    }
  }

  /**
   * Only clients that have this conversation open hear about it. The tenant
   * check that would otherwise be needed here happened when they asked to
   * watch it - see requireConversationInTenant in routes/dashboard.ts - so a
   * conversation id alone is enough to fan out safely, which matters because
   * the callers (a live chat session, a merge in another process) have the id
   * and not always the tenant.
   */
  emitConversation(conversationId: string, event: DashboardConversationEvent) {
    for (const client of this.#byConversation.get(conversationId) ?? []) {
      client.send({ type: "conversation", conversationId, event });
    }
  }

  /** Test seam. */
  clear() {
    this.#clients.clear();
    this.#byTenant.clear();
    this.#byConversation.clear();
  }

  #stopWatching(client: DashboardClient) {
    const conversationId = client.watching;
    client.watching = null;
    if (!conversationId) return;

    const watchers = this.#byConversation.get(conversationId);
    watchers?.delete(client);
    if (watchers?.size === 0) this.#byConversation.delete(conversationId);
  }

  /** Each watcher gets the list minus themselves - the dashboard shows "also
   * viewing", and two tabs of one agent are one viewer, not two. */
  #publishViewers(conversationId: string) {
    const watchers = this.#byConversation.get(conversationId);
    if (!watchers) return;

    const byUser = new Map<string, DashboardViewer>();
    for (const w of watchers) {
      if (!byUser.has(w.userId)) byUser.set(w.userId, { userId: w.userId, name: w.name });
    }

    for (const client of watchers) {
      client.send({
        type: "viewers",
        conversationId,
        viewers: [...byUser.values()].filter((v) => v.userId !== client.userId),
      });
    }
  }
}

export const dashboardHub = new DashboardHub();
