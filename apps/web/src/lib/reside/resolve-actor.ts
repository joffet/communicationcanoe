import { createAdminService } from "@communication-canoe/database";
import type { ResideActorClaims } from "@communication-canoe/shared/schemas";
import { auth, authPool } from "@/lib/auth/server";
import { mapTenantRole } from "@/lib/auth/plugins/reside-sso-plugin";

/**
 * Phase 3's non-session counterpart to reside-sso-plugin.ts's inline
 * find-or-create - that logic lives inside a live createAuthEndpoint `ctx`
 * (ctx.context.adapter/internalAdapter) and can't be called from a plain API
 * route. resideUserId/resideClientUid are better-auth `additionalFields` on
 * its own "user" table (not the domain public.users table DomainService
 * models), so the lookup goes straight at that table via the auth pool.
 */
export async function findResideActorUserId(resideUserId: string): Promise<string | null> {
  const { rows } = await authPool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE "resideUserId" = $1`,
    [resideUserId],
  );
  return rows[0]?.id ?? null;
}

/** Reverse of findResideActorUserId (Phase 5): given comm-canoe user ids
 * (e.g. conversation_assignees.user_id), resolves each back to the reside
 * admin's resideUserId, so a reassignment UI can display a real name instead
 * of a meaningless comm-canoe-internal UUID. Best-effort per id - a user_id
 * with no resideUserId set (shouldn't happen for reside-created users, but
 * doesn't crash if it does) is simply absent from the returned map. */
export async function findResideUserIdsForUsers(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { rows } = await authPool.query<{ id: string; resideUserId: string | null }>(
    `SELECT id, "resideUserId" FROM "user" WHERE id = ANY($1)`,
    [userIds],
  );
  return new Map(
    rows.filter((row): row is { id: string; resideUserId: string } => Boolean(row.resideUserId))
      .map((row) => [row.id, row.resideUserId]),
  );
}

/**
 * Resolves a reside admin's comm-canoe platform user, creating one on first
 * contact. Mirrors invite-user.ts's proven no-session auth.api.createUser
 * call rather than the plugin's ctx-bound adapter calls. resideUserId is
 * declared `input: false` on the user schema, so it can't be set through
 * auth.api.createUser's public body - set via a direct follow-up update
 * instead, same as any other server-side-only field.
 *
 * Not lock-protected: two concurrent first-contact calls for the same actor
 * could both miss the initial lookup and race on auth.api.createUser's
 * unique-email constraint. Accepted, same risk tolerance as the rest of this
 * integration's background workers - a single admin's actions aren't
 * concurrent with themselves in practice.
 */
export async function resolveOrCreateResideActor(
  claims: ResideActorClaims & { resideClientUid: string },
): Promise<{ userId: string }> {
  let userId = await findResideActorUserId(claims.resideUserId);

  if (!userId) {
    const created = await auth.api.createUser({
      body: {
        email: claims.email,
        name: claims.name?.trim() || claims.email,
        role: "user",
      },
    });
    if (!created?.user?.id) {
      throw new Error(`Failed to create comm-canoe user for reside actor ${claims.resideUserId}`);
    }
    userId = created.user.id;

    await authPool.query(
      `UPDATE "user" SET "resideUserId" = $1, "resideClientUid" = $2 WHERE id = $3`,
      [claims.resideUserId, claims.resideClientUid, userId],
    );
  }

  const admin = createAdminService();
  // NOTE: the `"user"."resideClientUid"` write above deliberately stores reside's
  // own identifier (it is a plain text better-auth additionalField recording who
  // the actor is on reside's side). This membership row is the opposite: its
  // tenant_id is a uuid FK into tenants, so it must carry comm-canoe's internal
  // id. Passing claims.resideClientUid here would be a uuid cast error for a
  // slug uid, or an FK violation for a uuid one.
  const tenant = await admin.getTenantByResideClientUid(claims.resideClientUid);
  if (!tenant) {
    throw new Error(`No comm-canoe tenant for reside client ${claims.resideClientUid}`);
  }
  await admin.upsertTenantMembership(userId, tenant.id, mapTenantRole(claims.role));

  return { userId };
}
