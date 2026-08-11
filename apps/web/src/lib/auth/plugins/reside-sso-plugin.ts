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

          const admin = createAdminService();
          await admin.upsertTenantMembership(
            user.id,
            claims.resideClientUid,
            mapTenantRole(claims.role),
          );

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
