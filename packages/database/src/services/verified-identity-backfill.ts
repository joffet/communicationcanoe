import { and, eq, isNull, sql } from "drizzle-orm";
import { UUID_PATTERN } from "../anonymize";
import type { Db } from "../db";
import { identities } from "../schema";
import type { TenantId } from "@communication-canoe/shared/brands";

/**
 * An attestation from independently verified historical creation evidence.
 * A current address, phone, or mutable reside_resident_id is never evidence.
 */
export type VerifiedIdentityAttestation = {
  identityId: string;
  residentId: string;
};

export type LinkageBackfillResult = {
  eligible: number;
  alreadyLinked: number;
  applied: number;
  missingOrErased: number;
  conflictingOrMerged: number;
  unverified: number;
};

/** Backfill exact IDs only. Reports counts, and is read-only unless explicitly asked to apply. */
export async function backfillVerifiedIdentityLinkage(
  db: Db,
  tenantId: TenantId,
  attestations: VerifiedIdentityAttestation[],
  apply = false,
): Promise<LinkageBackfillResult> {
  const byIdentity = new Map<string, Set<string>>();
  for (const { identityId, residentId } of attestations) {
    if (!UUID_PATTERN.test(identityId) || !UUID_PATTERN.test(residentId)) {
      throw new Error("Invalid identity linkage attestation");
    }
    const identity = identityId.toLowerCase();
    const residents = byIdentity.get(identity) ?? new Set<string>();
    residents.add(residentId.toLowerCase());
    byIdentity.set(identity, residents);
  }

  return db.transaction(async (tx) => {
    const result = { eligible: 0, alreadyLinked: 0, applied: 0, missingOrErased: 0, conflictingOrMerged: 0, unverified: 0 };
    for (const [id, residents] of [...byIdentity].sort(([left], [right]) => left.localeCompare(right))) {
      const residentId = [...residents][0];
      const ownership = tx.select().from(identities).where(and(
        eq(identities.tenantId, tenantId), eq(identities.id, id), isNull(identities.anonymizedAt),
      ));
      const [row] = apply ? await ownership.for("update") : await ownership;
      if (!row) {
        result.missingOrErased++;
        continue;
      }
      const mergeHistory = (await tx.execute(sql`
        select exists (
          select 1 from identity_merge_logs
          where tenant_id = ${tenantId} and (identity_a_id = ${id} or identity_b_id = ${id})
          union all
          select 1 from identities where tenant_id = ${tenantId} and merged_into_id = ${id}
        ) as found
      `)) as { rows: { found: boolean }[] };
      if (residents.size > 1 || row.resideOwnershipConflict || row.mergedIntoId || mergeHistory.rows[0].found ||
          (row.resideResidentId && row.resideResidentId !== residentId) ||
          (row.verifiedResideResidentId && row.verifiedResideResidentId !== residentId)) {
        result.conflictingOrMerged++;
        continue;
      }
      if (row.verifiedResideResidentId) {
        result.alreadyLinked++;
        continue;
      }
      result.eligible++;
      if (apply) {
        await tx.update(identities).set({ verifiedResideResidentId: residentId }).where(and(
          eq(identities.tenantId, tenantId), eq(identities.id, id), isNull(identities.verifiedResideResidentId),
        ));
        result.applied++;
      }
    }
    const { rows } = (await tx.execute(sql`
      select count(*)::int as count from identities
      where tenant_id = ${tenantId} and anonymized_at is null and verified_reside_resident_id is null
        and (email is not null or phone is not null)
    `)) as { rows: { count: number }[] };
    result.unverified = rows[0].count;
    return result;
  });
}
