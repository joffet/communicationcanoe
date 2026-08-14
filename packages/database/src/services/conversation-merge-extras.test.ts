import { describe, expect, it } from "vitest";
import { createFakeSupabaseClient } from "../testing/fake-supabase-client";
import type { AppSupabaseClient } from "../client";
import { DomainService } from "./index";

/**
 * moveConversationExtras is private - exercised directly here (bypassing
 * the public mergeConversations) because that entry point also pulls in
 * identity-chain validation, tenant checks, and a Supabase Realtime
 * broadcast, none of which are part of the extras-move logic these tests
 * target. TypeScript's `private` is compile-time only, so casting past it
 * for a test is safe.
 */
function moveExtras(domain: DomainService, sourceId: string, targetId: string): Promise<void> {
  return (domain as unknown as { moveConversationExtras: (s: string, t: string) => Promise<void> })
    .moveConversationExtras(sourceId, targetId);
}

function service(seed: Parameters<typeof createFakeSupabaseClient>[0]) {
  const db = createFakeSupabaseClient(seed);
  const domain = new DomainService(db as unknown as AppSupabaseClient);
  return { db, domain };
}

const SOURCE = "conv-source";
const TARGET = "conv-target";

describe("moveConversationExtras merge", () => {
  it("moves tags, assignees, and personal tags from source onto target", async () => {
    const { db, domain } = service({
      conversation_tags: [{ conversation_id: SOURCE, tag_id: "tag-1" }],
      conversation_assignees: [{ conversation_id: SOURCE, user_id: "admin-1", assigned_by: "admin-2" }],
      conversation_personal_tags: [{ conversation_id: SOURCE, user_id: "admin-3" }],
    });

    await moveExtras(domain, SOURCE, TARGET);

    expect(db.__table("conversation_tags")).toEqual([{ conversation_id: TARGET, tag_id: "tag-1" }]);
    expect(db.__table("conversation_assignees")).toEqual([
      { conversation_id: TARGET, user_id: "admin-1", assigned_by: "admin-2" },
    ]);
    expect(db.__table("conversation_personal_tags")).toEqual([{ conversation_id: TARGET, user_id: "admin-3" }]);
  });

  it("dedupes a tag/assignee/personal-tag that already exists on the target", async () => {
    const { db, domain } = service({
      conversation_tags: [
        { conversation_id: SOURCE, tag_id: "tag-shared" },
        { conversation_id: TARGET, tag_id: "tag-shared" },
      ],
      conversation_personal_tags: [
        { conversation_id: SOURCE, user_id: "admin-1" },
        { conversation_id: TARGET, user_id: "admin-1" },
      ],
    });

    await moveExtras(domain, SOURCE, TARGET);

    expect(db.__table("conversation_tags")).toHaveLength(1);
    expect(db.__table("conversation_personal_tags")).toHaveLength(1);
  });

  it("deletes every moved row from the source conversation", async () => {
    const { db, domain } = service({
      conversation_tags: [{ conversation_id: SOURCE, tag_id: "tag-1" }],
      conversation_assignees: [{ conversation_id: SOURCE, user_id: "admin-1" }],
      conversation_personal_tags: [{ conversation_id: SOURCE, user_id: "admin-1" }],
      conversation_read_states: [{ conversation_id: SOURCE, user_id: "admin-1", last_read_at: "2026-08-01T00:00:00.000Z" }],
    });

    await moveExtras(domain, SOURCE, TARGET);

    for (const table of [
      "conversation_tags",
      "conversation_assignees",
      "conversation_personal_tags",
      "conversation_read_states",
    ]) {
      expect(db.__table(table).filter((r) => r.conversation_id === SOURCE)).toHaveLength(0);
    }
  });

  it("moves a read cursor that only exists on the source", async () => {
    const { db, domain } = service({
      conversation_read_states: [
        { conversation_id: SOURCE, user_id: "admin-1", last_read_at: "2026-08-01T00:00:00.000Z", last_read_message_id: "msg-1" },
      ],
    });

    await moveExtras(domain, SOURCE, TARGET);

    expect(db.__table("conversation_read_states")).toEqual([
      { conversation_id: TARGET, user_id: "admin-1", last_read_at: "2026-08-01T00:00:00.000Z", last_read_message_id: "msg-1" },
    ]);
  });

  it("keeps the target's read cursor when it is newer than the source's for the same user", async () => {
    const { db, domain } = service({
      conversation_read_states: [
        { conversation_id: SOURCE, user_id: "admin-1", last_read_at: "2026-08-01T00:00:00.000Z", last_read_message_id: "msg-old" },
        { conversation_id: TARGET, user_id: "admin-1", last_read_at: "2026-08-05T00:00:00.000Z", last_read_message_id: "msg-new" },
      ],
    });

    await moveExtras(domain, SOURCE, TARGET);

    const rows = db.__table("conversation_read_states");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversation_id: TARGET, last_read_at: "2026-08-05T00:00:00.000Z", last_read_message_id: "msg-new" });
  });

  it("adopts the source's read cursor when it is newer than the target's for the same user", async () => {
    const { db, domain } = service({
      conversation_read_states: [
        { conversation_id: SOURCE, user_id: "admin-1", last_read_at: "2026-08-05T00:00:00.000Z", last_read_message_id: "msg-new" },
        { conversation_id: TARGET, user_id: "admin-1", last_read_at: "2026-08-01T00:00:00.000Z", last_read_message_id: "msg-old" },
      ],
    });

    await moveExtras(domain, SOURCE, TARGET);

    const rows = db.__table("conversation_read_states");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversation_id: TARGET, last_read_at: "2026-08-05T00:00:00.000Z", last_read_message_id: "msg-new" });
  });

  it("keeps independent read cursors for different users, taking the max per user", async () => {
    const { db, domain } = service({
      conversation_read_states: [
        { conversation_id: SOURCE, user_id: "admin-1", last_read_at: "2026-08-05T00:00:00.000Z" },
        { conversation_id: TARGET, user_id: "admin-2", last_read_at: "2026-08-02T00:00:00.000Z" },
      ],
    });

    await moveExtras(domain, SOURCE, TARGET);

    const byUser = new Map(db.__table("conversation_read_states").map((r) => [r.user_id, r]));
    expect(byUser.get("admin-1")).toMatchObject({ conversation_id: TARGET, last_read_at: "2026-08-05T00:00:00.000Z" });
    expect(byUser.get("admin-2")).toMatchObject({ conversation_id: TARGET, last_read_at: "2026-08-02T00:00:00.000Z" });
  });
});
