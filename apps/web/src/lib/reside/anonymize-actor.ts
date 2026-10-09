import { ANONYMIZED_USER_NAME, anonymizedUserEmail } from "@communication-canoe/database/anonymize";
import type { ResideClientUid } from "@communication-canoe/database";
import { authPool } from "@/lib/auth/server";

/**
 * The comm-canoe side of a reside account being anonymized (30 days after it
 * was deleted): the platform user resolve-actor.ts created for it, which names
 * the person as the author of replies, assignments and notes. Those records
 * stay; the name and address on the user go, and so do its sign-in rows.
 *
 * Scoped by resideClientUid as well as resideUserId, so a call for one
 * building can only reach the account that building's reside created.
 * Returns false when there is no such user or it was already done.
 */
export async function anonymizeResideUser(
  resideClientUid: ResideClientUid,
  resideUserId: string,
): Promise<boolean> {
  const placeholder = anonymizedUserEmail(resideUserId);
  const client = await authPool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM "user" WHERE "resideUserId" = $1 AND "resideClientUid" = $2 FOR UPDATE`,
      [resideUserId, resideClientUid],
    );
    const user = rows[0];
    if (!user || user.email === placeholder) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(`UPDATE "user" SET name = $1, email = $2 WHERE id = $3`, [
      ANONYMIZED_USER_NAME,
      placeholder,
      user.id,
    ]);
    await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [user.id]);
    await client.query(`DELETE FROM "account" WHERE "userId" = $1`, [user.id]);
    await client.query(`DELETE FROM "verification" WHERE identifier = $1`, [user.email]);
    await client.query(
      `UPDATE public.users SET name = $1, email = $2, phone_number = NULL WHERE id = $3`,
      [ANONYMIZED_USER_NAME, placeholder, user.id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
