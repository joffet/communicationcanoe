import { afterEach, describe, expect, it } from "vitest";
import type { DashboardServerMessage } from "@communication-canoe/shared/realtime";
import { asTenantId } from "@communication-canoe/database";
import { dashboardHub, type DashboardClient } from "./dashboard-hub.js";

const TENANT_A = asTenantId("11111111-1111-1111-1111-111111111111");
const TENANT_B = asTenantId("22222222-2222-2222-2222-222222222222");

function connect(tenantId: typeof TENANT_A, userId: string, name = userId) {
  const received: DashboardServerMessage[] = [];
  const client: DashboardClient = {
    tenantId,
    userId,
    name,
    watching: null,
    send: (msg) => received.push(msg),
  };
  dashboardHub.add(client);
  return { client, received };
}

function viewersIn(received: DashboardServerMessage[], conversationId: string) {
  const last = [...received]
    .reverse()
    .find((m) => m.type === "viewers" && m.conversationId === conversationId);
  return last?.type === "viewers" ? last.viewers.map((v) => v.userId) : undefined;
}

afterEach(() => dashboardHub.clear());

describe("needs_human fan-out", () => {
  it("reaches every socket of the tenant and no socket of another", () => {
    const a1 = connect(TENANT_A, "agent-1");
    const a2 = connect(TENANT_A, "agent-2");
    const b = connect(TENANT_B, "agent-3");

    dashboardHub.emitNeedsHuman(TENANT_A, "conv-1");

    const expected = { type: "needs_human", conversationId: "conv-1" };
    expect(a1.received).toContainEqual(expected);
    expect(a2.received).toContainEqual(expected);
    expect(b.received).toEqual([]);
  });
});

describe("conversation fan-out", () => {
  it("reaches only the sockets watching that conversation", () => {
    const watching = connect(TENANT_A, "agent-1");
    const elsewhere = connect(TENANT_A, "agent-2");
    dashboardHub.watch(watching.client, "conv-1");
    dashboardHub.watch(elsewhere.client, "conv-2");

    dashboardHub.emitConversation("conv-1", "message");

    expect(watching.received).toContainEqual({
      type: "conversation",
      conversationId: "conv-1",
      event: "message",
    });
    expect(elsewhere.received.some((m) => m.type === "conversation")).toBe(false);
  });

  it("stops reaching a socket that moved to another conversation", () => {
    const client = connect(TENANT_A, "agent-1");
    dashboardHub.watch(client.client, "conv-1");
    dashboardHub.watch(client.client, "conv-2");

    dashboardHub.emitConversation("conv-1", "updated");

    expect(client.received.some((m) => m.type === "conversation")).toBe(false);
  });
});

describe("presence", () => {
  it("tells each watcher about the others, never about themselves", () => {
    const first = connect(TENANT_A, "agent-1");
    const second = connect(TENANT_A, "agent-2");

    dashboardHub.watch(first.client, "conv-1");
    dashboardHub.watch(second.client, "conv-1");

    expect(viewersIn(first.received, "conv-1")).toEqual(["agent-2"]);
    expect(viewersIn(second.received, "conv-1")).toEqual(["agent-1"]);
  });

  /** Two tabs is one person looking, which is what the avatar row claims. */
  it("counts an agent with two sockets once", () => {
    const other = connect(TENANT_A, "agent-1");
    const tab1 = connect(TENANT_A, "agent-2");
    const tab2 = connect(TENANT_A, "agent-2");

    dashboardHub.watch(other.client, "conv-1");
    dashboardHub.watch(tab1.client, "conv-1");
    dashboardHub.watch(tab2.client, "conv-1");

    expect(viewersIn(other.received, "conv-1")).toEqual(["agent-2"]);
  });

  it("clears a viewer when their socket closes", () => {
    const staying = connect(TENANT_A, "agent-1");
    const leaving = connect(TENANT_A, "agent-2");
    dashboardHub.watch(staying.client, "conv-1");
    dashboardHub.watch(leaving.client, "conv-1");

    dashboardHub.remove(leaving.client);

    expect(viewersIn(staying.received, "conv-1")).toEqual([]);
  });

  it("clears a viewer when they open a different conversation", () => {
    const staying = connect(TENANT_A, "agent-1");
    const moving = connect(TENANT_A, "agent-2");
    dashboardHub.watch(staying.client, "conv-1");
    dashboardHub.watch(moving.client, "conv-1");

    dashboardHub.watch(moving.client, null);

    expect(viewersIn(staying.received, "conv-1")).toEqual([]);
  });

  it("does not resend an unchanged viewer list on a repeated watch", () => {
    const client = connect(TENANT_A, "agent-1");
    dashboardHub.watch(client.client, "conv-1");
    const before = client.received.length;

    dashboardHub.watch(client.client, "conv-1");

    expect(client.received.length).toBe(before);
  });
});
