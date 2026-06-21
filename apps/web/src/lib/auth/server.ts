import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins";
import { Pool } from "pg";
import type { PlatformRole } from "@communication-canoe/database";
import { sendMagicLinkEmail } from "@/lib/email/magic-link";
import { consumeInviteEmailVariant } from "@/lib/email/invite-email-context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function parseSuperAdminEmails(): Set<string> {
  const raw = process.env.SUPER_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolvePlatformRole(email: string): PlatformRole {
  return parseSuperAdminEmails().has(email.trim().toLowerCase())
    ? "super_admin"
    : "user";
}

async function syncAppUser(user: { id: string; email: string; name: string }) {
  const platformRole = resolvePlatformRole(user.email);
  await pool.query(
    `INSERT INTO public.users (id, email, name, platform_role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       name = COALESCE(public.users.name, EXCLUDED.name),
       platform_role = CASE
         WHEN public.users.platform_role = 'super_admin' THEN 'super_admin'
         WHEN $4 = 'super_admin' THEN 'super_admin'
         ELSE public.users.platform_role
       END`,
    [user.id, user.email, user.name || user.email.split("@")[0], platformRole],
  );
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  database: pool,
  plugins: [
    admin({
      defaultRole: "user",
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const variant = consumeInviteEmailVariant(email);
        await sendMagicLinkEmail({ to: email, url, variant });
      },
    }),
  ],
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await syncAppUser(user);
        },
      },
    },
  },
});

export { pool as authPool };
