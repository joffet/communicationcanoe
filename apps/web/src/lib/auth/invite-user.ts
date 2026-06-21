import { headers } from "next/headers";
import { createAdminService } from "@communication-canoe/database";
import { auth } from "./server";
import { toAbsoluteAppUrl } from "@/lib/email/site-origin";
import { markPendingInviteEmail } from "@/lib/email/invite-email-context";

export type InviteUserResult =
  | { ok: true; userId: string }
  | { ok: false; message: string };

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export async function invitePlatformUser(input: {
  email: string;
  name?: string | null;
  sendInvite?: boolean;
  platformRole?: "user" | "super_admin";
  callbackPath?: string;
}): Promise<InviteUserResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  const admin = createAdminService();
  const existing = await admin.getUserByEmail(email);
  let userId = existing?.id;

  if (!userId) {
    try {
      const created = await auth.api.createUser({
        body: {
          email,
          name: input.name?.trim() || (email.split("@")[0] ?? "User"),
          role: "user",
        },
      });

      if (!created?.user?.id) {
        return { ok: false, message: "Failed to create user." };
      }

      userId = created.user.id;
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to create user.",
      };
    }
  }

  if (input.platformRole && input.platformRole !== "user") {
    await admin.updateUser(userId, { platform_role: input.platformRole });
  } else if (input.name?.trim()) {
    await admin.updateUser(userId, { name: input.name.trim() });
  }

  const sendInvite = input.sendInvite !== false;
  if (sendInvite) {
    const callbackURL = await toAbsoluteAppUrl(input.callbackPath ?? "/inbox");
    try {
      markPendingInviteEmail(email);
      const result = await auth.api.signInMagicLink({
        body: { email, callbackURL },
        headers: await headers(),
      });

      if (!result) {
        return {
          ok: false,
          message: "User saved, but sign-in email could not be sent.",
        };
      }
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error
            ? `User saved, but sign-in email failed: ${err.message}`
            : "User saved, but sign-in email failed.",
      };
    }
  }

  return { ok: true, userId };
}
