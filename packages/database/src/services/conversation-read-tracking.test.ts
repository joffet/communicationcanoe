import { describe, expect, it } from "vitest";
import { createFakeSupabaseClient } from "../testing/fake-supabase-client";
import type { AppSupabaseClient } from "../client";
import { DomainService } from "./index";

function service(seed: Parameters<typeof createFakeSupabaseClient>[0]) {
  const db = createFakeSupabaseClient(seed);
  const domain = new DomainService(db as unknown as AppSupabaseClient);
  return { db, domain };
}

const VIEWER = "viewer-1";
const OTHER_ADMIN = "admin-2";

describe("getViewerConversationStates", () => {
  it("marks a conversation unread when the viewer is an assignee with no read cursor", async () => {
    const { domain } = service({
      conversation_assignees: [{ conversation_id: "conv-a", user_id: VIEWER }],
    });

    const states = await domain.getViewerConversationStates(
      [{ id: "conv-a", last_message_at: "2026-08-01T00:00:00.000Z" }],
      VIEWER,
    );

    expect(states.get("conv-a")).toEqual({
      viewer_is_relevant: true,
      viewer_has_unread: true,
      viewer_last_read_at: null,
    });
  });

  it("marks a conversation read when the read cursor is at or after the last message", async () => {
    const { domain } = service({
      conversation_assignees: [{ conversation_id: "conv-b", user_id: VIEWER }],
      conversation_read_states: [
        { conversation_id: "conv-b", user_id: VIEWER, last_read_at: "2026-08-01T12:00:00.000Z" },
      ],
    });

    const states = await domain.getViewerConversationStates(
      [{ id: "conv-b", last_message_at: "2026-08-01T00:00:00.000Z" }],
      VIEWER,
    );

    expect(states.get("conv-b")).toMatchObject({ viewer_is_relevant: true, viewer_has_unread: false });
  });

  it("stays unread when the read cursor predates a newer message", async () => {
    const { domain } = service({
      conversation_assignees: [{ conversation_id: "conv-c", user_id: VIEWER }],
      conversation_read_states: [
        { conversation_id: "conv-c", user_id: VIEWER, last_read_at: "2026-08-01T00:00:00.000Z" },
      ],
    });

    const states = await domain.getViewerConversationStates(
      [{ id: "conv-c", last_message_at: "2026-08-01T12:00:00.000Z" }],
      VIEWER,
    );

    expect(states.get("conv-c")).toMatchObject({ viewer_is_relevant: true, viewer_has_unread: true });
  });

  it("treats a personal tag as relevant even without an assignee row", async () => {
    const { domain } = service({
      conversation_personal_tags: [{ conversation_id: "conv-d", user_id: VIEWER }],
    });

    const states = await domain.getViewerConversationStates(
      [{ id: "conv-d", last_message_at: "2026-08-01T00:00:00.000Z" }],
      VIEWER,
    );

    expect(states.get("conv-d")).toMatchObject({ viewer_is_relevant: true });
  });

  it("is never relevant or unread for a conversation the viewer has no association with", async () => {
    const { domain } = service({
      conversation_assignees: [{ conversation_id: "conv-e", user_id: OTHER_ADMIN }],
    });

    const states = await domain.getViewerConversationStates(
      [{ id: "conv-e", last_message_at: "2026-08-01T00:00:00.000Z" }],
      VIEWER,
    );

    expect(states.get("conv-e")).toEqual({
      viewer_is_relevant: false,
      viewer_has_unread: false,
      viewer_last_read_at: null,
    });
  });
});

describe("getConversationMetricsForViewer", () => {
  it("counts open vs unread independently and excludes non-relevant/merged conversations", async () => {
    const { domain } = service({
      conversations: [
        { id: "open-unread", tenant_id: "tenant-1", status: "open", last_message_at: "2026-08-02T00:00:00.000Z" },
        {
          id: "resolved-unread",
          tenant_id: "tenant-1",
          status: "resolved",
          last_message_at: "2026-08-02T00:00:00.000Z",
        },
        { id: "pending-read", tenant_id: "tenant-1", status: "pending", last_message_at: "2026-08-01T00:00:00.000Z" },
        { id: "not-relevant", tenant_id: "tenant-1", status: "open", last_message_at: "2026-08-01T00:00:00.000Z" },
        {
          id: "merged-away",
          tenant_id: "tenant-1",
          status: "merged",
          last_message_at: "2026-08-03T00:00:00.000Z",
        },
      ],
      conversation_assignees: [
        { conversation_id: "open-unread", user_id: VIEWER },
        { conversation_id: "resolved-unread", user_id: VIEWER },
        { conversation_id: "pending-read", user_id: VIEWER },
        { conversation_id: "not-relevant", user_id: OTHER_ADMIN },
        // A merged-away conversation's assignee row would already have been
        // moved onto its target by moveConversationExtras in real usage -
        // seeded here anyway to prove the metrics query excludes 'merged'
        // conversations up front regardless.
        { conversation_id: "merged-away", user_id: VIEWER },
      ],
      conversation_read_states: [
        { conversation_id: "pending-read", user_id: VIEWER, last_read_at: "2026-08-01T00:00:00.000Z" },
      ],
    });

    const metrics = await domain.getConversationMetricsForViewer("tenant-1", VIEWER);

    expect(metrics).toEqual({ unread_relevant_count: 2, open_relevant_count: 2 });
  });
});

describe("markConversationRead", () => {
  it("advances the cursor to the newest message and is idempotent on repeat calls", async () => {
    const { db, domain } = service({
      messages: [
        { id: "msg-1", conversation_id: "conv-f", created_at: "2026-08-01T00:00:00.000Z" },
        { id: "msg-2", conversation_id: "conv-f", created_at: "2026-08-02T00:00:00.000Z" },
      ],
    });
    db.__registerRpc("conversation_merge_chain_ids", () => ["conv-f"]);

    const first = await domain.markConversationRead("conv-f", VIEWER);
    expect(first).toMatchObject({ last_read_message_id: "msg-2", last_read_at: "2026-08-02T00:00:00.000Z" });

    const second = await domain.markConversationRead("conv-f", VIEWER);
    expect(second).toMatchObject({ last_read_message_id: "msg-2" });
    expect(db.__table("conversation_read_states")).toHaveLength(1);
  });

  it("reads across the whole merge chain, not just the conversation id passed in", async () => {
    const { db, domain } = service({
      messages: [
        { id: "msg-old", conversation_id: "conv-target", created_at: "2026-08-01T00:00:00.000Z" },
        { id: "msg-new", conversation_id: "conv-source", created_at: "2026-08-03T00:00:00.000Z" },
      ],
    });
    // Simulates a merge where conv-source merged into conv-target - the
    // chain RPC returns both ids for either member.
    db.__registerRpc("conversation_merge_chain_ids", () => ["conv-target", "conv-source"]);

    const readState = await domain.markConversationRead("conv-target", VIEWER);

    expect(readState).toMatchObject({ last_read_message_id: "msg-new", last_read_at: "2026-08-03T00:00:00.000Z" });
  });
});
