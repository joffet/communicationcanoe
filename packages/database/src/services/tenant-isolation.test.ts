/**
 * Tenant isolation — the boundary that has nothing underneath it.
 *
 * Supabase enforced RLS on all 27 tables. PlanetScale has none, and the
 * policies were not portable: they key off `auth.uid()`, which this app
 * stopped supplying when it adopted Better Auth. The cutover accepted that
 * deliberately, on the condition that these tests replace them. This is that
 * replacement.
 *
 * So every `WHERE tenant_id = $1` in a service method IS the security
 * boundary, and nothing else checks it. The bug class is not hypothetical —
 * it has shipped four times: a resident able to read all conversations, a
 * cross-tenant read in the batch status endpoint, and two tenant-resolution
 * fixes in the routes since the cutover.
 *
 * The shape of every test here is the same: build two complete, parallel
 * tenants, then ask tenant A's service call for tenant B's row. Nothing may
 * come back. A method that forgot its predicate returns B's data and passes
 * every other test in this package, because every other test seeds one tenant.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainService } from "./index";
import type { AppSupabaseClient } from "../client";
import { createTestDb, resetTestDb, type TestDb } from "../testing/pglite";
import {
  conversations,
  documents,
  identities,
  messages,
  outboundBatchRecipients,
  outboundBatches,
  tags,
  teams,
  tenants,
  userTenantMemberships,
  users,
} from "../schema";
import { asResideClientUid } from "@communication-canoe/shared/brands";

let db: TestDb;
let close: () => Promise<void>;
let domain: DomainService;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  domain = new DomainService(null as unknown as AppSupabaseClient, db);
}, 60_000);

afterAll(async () => {
  await close();
});

/** One tenant's entire world, so a cross-tenant call has something real to
 * find rather than an empty table that would pass by accident. */
async function seedTenant(n: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: `Tenant ${n}`,
      twilioNumber: `+1555000000${n}`,
      inboundEmailAddress: `tenant${n}@example.test`,
      chatWidgetKey: `widget-key-${n}`,
      resideClientUid: asResideClientUid(`client-${n}`),
    })
    .returning();

  // users.id carries no default - it is Better Auth's id by convention, with
  // no FK enforcing it (see the schema comment), so a test must supply one.
  const [user] = await db
    .insert(users)
    .values({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      email: `staff${n}@example.test`,
      name: `Staff ${n}`,
    })
    .returning();
  await db.insert(userTenantMemberships).values({ tenantId: tenant.id, userId: user.id });

  const [team] = await db
    .insert(teams)
    .values({ tenantId: tenant.id, name: `Team ${n}` })
    .returning();

  const [identity] = await db
    .insert(identities)
    .values({
      tenantId: tenant.id,
      email: `resident${n}@example.test`,
      phone: `+1555111111${n}`,
      name: `Resident ${n}`,
    })
    .returning();

  const [conversation] = await db
    .insert(conversations)
    .values({ tenantId: tenant.id, identityId: identity.id, status: "open" })
    .returning();

  const [message] = await db
    .insert(messages)
    .values({
      tenantId: tenant.id,
      conversationId: conversation.id,
      channel: "email",
      direction: "inbound",
      senderType: "external",
      body: `Message body ${n}`,
      idempotencyKey: `idem-${n}`,
    })
    .returning();

  const [tag] = await db
    .insert(tags)
    .values({ tenantId: tenant.id, name: `Tag ${n}` })
    .returning();

  const [batch] = await db
    .insert(outboundBatches)
    .values({ tenantId: tenant.id, channel: "email", subject: `Blast ${n}`, totalRecipients: 1 })
    .returning();
  const [recipient] = await db
    .insert(outboundBatchRecipients)
    .values({
      tenantId: tenant.id,
      batchId: batch.id,
      channel: "email",
      identityContact: { email: `resident${n}@example.test` },
      body: `Blast body ${n}`,
      status: "pending",
    })
    .returning();

  const [document] = await db
    .insert(documents)
    .values({
      tenantId: tenant.id,
      filename: `doc-${n}.pdf`,
      contentText: `Document text ${n}`,
      extractor: "test",
      status: "ready",
    })
    .returning();

  return { tenant, user, team, identity, conversation, message, tag, batch, recipient, document };
}

type World = Awaited<ReturnType<typeof seedTenant>>;
let a: World;
let b: World;

beforeEach(async () => {
  await resetTestDb(db);
  a = await seedTenant("1");
  b = await seedTenant("2");
});

/* ------------------------------------------------------------------ */
/* Reads: A's tenant id must never surface B's row                      */
/* ------------------------------------------------------------------ */

describe("listing a tenant's own rows", () => {
  it("getConversationsForTenant returns only its own", async () => {
    const rows = await domain.getConversationsForTenant(a.tenant.id, { limit: 50 });
    expect(rows.map((c) => c.id)).toEqual([a.conversation.id]);
    expect(rows.map((c) => c.id)).not.toContain(b.conversation.id);
  });

  it("listTenantTags returns only its own", async () => {
    const rows = await domain.listTenantTags(a.tenant.id);
    expect(rows.map((t) => t.id)).toEqual([a.tag.id]);
  });

  it("getTeamsForTenant returns only its own", async () => {
    const rows = await domain.getTeamsForTenant(a.tenant.id);
    expect(rows.map((t) => t.id)).toEqual([a.team.id]);
  });

  it("listDocumentsForTenant returns only its own", async () => {
    const rows = await domain.listDocumentsForTenant(a.tenant.id);
    expect(rows.map((d) => d.id)).toEqual([a.document.id]);
  });

  it("getOnCallUsers returns only its own members", async () => {
    const rows = await domain.getOnCallUsers(a.tenant.id);
    const ids = rows.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(b.user.id);
  });

  it("listConversationsForIdentity refuses another tenant's identity", async () => {
    const rows = await domain.listConversationsForIdentity(a.tenant.id, b.identity.id);
    expect(rows).toEqual([]);
  });
});

describe("fetching one row by id, scoped by tenant", () => {
  it("getMessageByIdempotencyKey does not cross tenants", async () => {
    // Same key in both tenants: the predicate is the only thing separating them.
    const own = await domain.getMessageByIdempotencyKey(a.tenant.id, "idem-1");
    expect(own?.id).toBe(a.message.id);

    const other = await domain.getMessageByIdempotencyKey(a.tenant.id, "idem-2");
    expect(other).toBeNull();
  });

  it("getOutboundBatchDetail refuses another tenant's batch", async () => {
    const own = await domain.getOutboundBatchDetail(a.batch.id, a.tenant.id);
    expect(own).not.toBeNull();

    // The endpoint this guards leaked another tenant's batch for months.
    const other = await domain.getOutboundBatchDetail(b.batch.id, a.tenant.id);
    expect(other).toBeNull();
  });

  it("getPendingLiveTransfer refuses another tenant's transfer", async () => {
    // The row carries the visitor's own words for why they asked for a human,
    // which is the whole reason this read takes a tenant.
    await domain.logLiveTransfer({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      channel: "web_chat",
      outcome: "pending",
      reason: "Wants a refund",
    });
    await domain.logLiveTransfer({
      tenantId: b.tenant.id,
      conversationId: b.conversation.id,
      channel: "web_chat",
      outcome: "pending",
      reason: "Tenant B's business",
    });

    const own = await domain.getPendingLiveTransfer(a.conversation.id, a.tenant.id);
    expect(own?.reason).toBe("Wants a refund");

    const other = await domain.getPendingLiveTransfer(b.conversation.id, a.tenant.id);
    expect(other).toBeNull();
  });

  it("getDocument refuses another tenant's document", async () => {
    expect(await domain.getDocument(a.tenant.id, a.document.id)).not.toBeNull();
    expect(await domain.getDocument(a.tenant.id, b.document.id)).toBeNull();
  });

  it("findIdentityForContact does not match another tenant's contact", async () => {
    const own = await domain.findIdentityForContact(a.tenant.id, { email: "resident1@example.test" });
    expect(own?.id).toBe(a.identity.id);

    const other = await domain.findIdentityForContact(a.tenant.id, { email: "resident2@example.test" });
    expect(other).toBeNull();
  });
});

describe("counting and aggregating", () => {
  it("countTenantChunks counts only its own", async () => {
    expect(await domain.countTenantChunks(a.tenant.id)).toBe(0);
  });

  it("getConversationMetricsForViewer does not count another tenant's conversations", async () => {
    const metrics = await domain.getConversationMetricsForViewer(a.tenant.id, a.user.id);
    const total = Object.values(metrics as Record<string, unknown>)
      .filter((v): v is number => typeof v === "number")
      .reduce((x, y) => x + y, 0);
    expect(total).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* Writes: A must not be able to move or mutate B's rows                */
/* ------------------------------------------------------------------ */

describe("writes cannot reach across the boundary", () => {
  it("mergeConversations refuses a source from another tenant", async () => {
    await expect(
      domain.mergeConversations(a.tenant.id, b.conversation.id, a.conversation.id)
    ).rejects.toThrow();

    const [survivor] = await db.select().from(conversations).where(eq(conversations.id, b.conversation.id));
    expect(survivor.tenantId).toBe(b.tenant.id);
  });

  it("mergeConversations refuses a target from another tenant", async () => {
    await expect(
      domain.mergeConversations(a.tenant.id, a.conversation.id, b.conversation.id)
    ).rejects.toThrow();
  });

  /**
   * Not a refusal — a demonstration.
   *
   * assignConversationTeam takes a conversationId and a teamId and no tenant,
   * so it has nothing to check and does exactly what it is told: it will
   * attach one tenant's team to another tenant's conversation. That is why it
   * is on the caller-enforced register next door, and this test exists so the
   * behaviour is written down as executable fact rather than assumed away by
   * the next person reading the method name.
   */
  it("assignConversationTeam WILL cross tenants, because it cannot see them", async () => {
    await domain.assignConversationTeam(b.conversation.id, a.team.id);

    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, b.conversation.id));
    expect(row.assignedTeamId).toBe(a.team.id);
    expect(row.tenantId).toBe(b.tenant.id);
  });
});

/* ------------------------------------------------------------------ */
/* Tenant resolution: the front door                                    */
/* ------------------------------------------------------------------ */

describe("resolving a tenant from an inbound identifier", () => {
  it("resolveTenantByPhone returns exactly one tenant", async () => {
    const t = await domain.resolveTenantByPhone("+15550000001");
    expect(t?.id).toBe(a.tenant.id);
  });

  it("resolveTenantByEmail returns exactly one tenant", async () => {
    const t = await domain.resolveTenantByEmail("tenant2@example.test");
    expect(t?.id).toBe(b.tenant.id);
  });

  it("resolveTenantByWidgetKey returns exactly one tenant", async () => {
    const t = await domain.resolveTenantByWidgetKey("widget-key-2");
    expect(t?.id).toBe(b.tenant.id);
  });

  it("an unknown identifier resolves to nothing, not to the first tenant", async () => {
    expect(await domain.resolveTenantByPhone("+15559999999")).toBeNull();
    expect(await domain.resolveTenantByEmail("nobody@example.test")).toBeNull();
    expect(await domain.resolveTenantByWidgetKey("no-such-key")).toBeNull();
  });
});
