# Verified legacy identity erasure

The `verified_reside_resident_id` column is an immutable attribution on a
specific Comm-canoe identity and tenant. New identity creation with an
explicit Reside resident ID records it before any contact can be renamed.
Enriching a row found by phone or email keeps the legacy routing behavior
without promoting that match to verified history. A distinct resident ID
later supplied for the same row is evidence of conflict. Keep rename enabled.

An erasure request may supply related IDs from Reside's recorded membership
lineage. The eraser accepts the established ID match and the tenant's
unconflicted contact-only fallback. A hash does not override an incompatible
owner. When a merge chain has mixed ownership, only independently verified,
unconflicted rows attributed to the erased subject are eligible. The endpoint
returns a count of protected conflicts for review. A contact-only identity
with no current hash or trusted linkage cannot be discovered automatically.

## Historical backfill

Use `backfillVerifiedIdentityLinkage` in the database service with a
tenant-scoped list of exact identity/resident ID pairs. The source must be an
independently verified historical attribution of that identity at creation.
A current contact match, the current compatibility resident ID, a send to a
reassigned contact or an unreviewed merge is insufficient. With no such
evidence, pass an empty list to count unverified contact rows. No row is
linked automatically from a current address or number.

The helper defaults to a dry run. It returns only counts for eligible,
already linked, missing or erased, conflicting or merged, and unverified
rows. Only a separate approved execution may apply the same reviewed list.
Application is transactionally idempotent. Mismatches and merge history are
skipped for review. Do not fill gaps by broadening the contact-hash match.

Apply the additive migration before building the new Comm-canoe receiver.
The old erasure body remains valid. Once the receiver is live, apply Reside's
additive queue migration and deploy the sender. No production backfill is
required for this rollout. Measure independently verified historical coverage
before considering removal of the rename bridge.
