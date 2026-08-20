import { createAuthEndpoint } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { User } from "better-auth/types";
import { z } from "zod";
import { createAdminService } from "@communication-canoe/database";
import { verifyResideSsoToken } from "../reside-sso";

const resideSsoBodySchema = z.object({ token: z.string() });

type ResideAuthUser = User & {
  resideUserId?: string | null;
  resideClientUid?: string | null;
};

export function mapTenantRole(role?: "admin" | "user" | "super"): "admin" | "member" {
  return role === "admin" || role === "super" ? "admin" : "member";
}

/**
 * Exchanges a reside-issued SSO token (see docs/reside-sso-contract.md) for a comm-canoe
 * session, provisioning/matching a local user keyed by reside's externalUserId — no direct
 * DynamoDB access into reside's account, no shared cookie domain required.
 */
export function resideSsoPlugin() {
  return {
    id: "reside-sso",
    endpoints: {
      resideSso: createAuthEndpoint(
        "/reside-sso",
        { method: "POST", body: resideSsoBodySchema },
        async (ctx) => {
          const claims = verifyResideSsoToken(ctx.body.token);
          if (!claims) {
            throw new APIError("UNAUTHORIZED", { message: "invalid_or_expired_token" });
          }

          // claims.resideClientUid is reside's own client identifier and may be a
          // slug like "cardiff" (see migration 20250701002000_tenant_reside_client_uid).
          // The membership row below is keyed by a uuid FK into tenants, so the uid has
          // to be resolved to comm-canoe's internal tenant id first - passing the uid
          // straight through is a uuid cast error for a slug, or an FK violation for a
          // uuid. Resolved before the user is provisioned so an unprovisioned client
          // cannot leave a membership-less user behind.
          const admin = createAdminService();
          const tenant = await admin.getTenantByResideClientUid(claims.resideClientUid);
          if (!tenant) {
            throw new APIError("FORBIDDEN", { message: "unknown_reside_client" });
          }

          let user = (await ctx.context.adapter.findOne({
            model: "user",
            where: [{ field: "resideUserId", value: claims.externalUserId }],
          })) as ResideAuthUser | null;

          if (!user) {
            user = (await ctx.context.internalAdapter.createUser({
              email: claims.email,
              name: claims.name,
              emailVerified: true,
              resideUserId: claims.externalUserId,
              resideClientUid: claims.resideClientUid,
            })) as ResideAuthUser;
          }

          await admin.upsertTenantMembership(user.id, tenant.id, mapTenantRole(claims.role));

          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "failed_to_create_session" });
          }

          await setSessionCookie(ctx, { session, user });

          return ctx.json({ user, redirectTo: "/inbox" });
        },
      ),
    },
  };
}
