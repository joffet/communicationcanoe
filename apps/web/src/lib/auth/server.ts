import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { Pool } from "pg";
import { sendMagicLinkEmail } from "@/lib/email/magic-link";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function syncAppUser(user: { id: string; email: string; name: string }) {
  await pool.query(
    `INSERT INTO public.users (id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       name = COALESCE(public.users.name, EXCLUDED.name)`,
    [user.id, user.email, user.name || user.email.split("@")[0]],
  );
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  database: pool,
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ to: email, url });
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
