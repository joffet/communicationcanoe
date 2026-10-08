import { createHash } from "node:crypto";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

// Shared with reside: its anonymizer writes the same placeholders onto its own
// rows (lib/residents/personAnonymization.ts), so a person reads the same in
// both systems once they are gone.
export const ANONYMIZED_RESIDENT_NAME = "Deleted resident";
export const ANONYMIZED_USER_NAME = "Deleted user";

/** Unique per row, so it fits the per-tenant email index and the
 * identities_contact_required check that a null email would fail. */
export function anonymizedIdentityEmail(identityId: string): string {
  return `deleted.${identityId}@anonymized.invalid`;
}

export function anonymizedUserEmail(resideUserId: string): string {
  return `deleted.${resideUserId}@anonymized.invalid`;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The contact hash reside sends when it asks for a person to be anonymized:
 * lowercase hex SHA-256 of the stored, normalized value (identities.email and
 * identities.phone as written by normalizeEmail/normalizePhone). Reside hashes
 * its own canonical values the same way; both repos test the same vectors.
 */
export function identityContactHash(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** identityContactHash computed in Postgres, for matching inside a query. */
export function identityContactHashSql(column: AnyColumn): SQL {
  return sql`encode(sha256(convert_to(${column}, 'UTF8')), 'hex')`;
}
