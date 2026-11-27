ALTER TABLE "identities" ADD COLUMN "verified_reside_resident_id" uuid;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "reside_ownership_conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "identities_tenant_verified_resident_idx" ON "identities" USING btree ("tenant_id","verified_reside_resident_id") WHERE "identities"."verified_reside_resident_id" is not null;
--> statement-breakpoint
CREATE FUNCTION keep_verified_reside_identity_linkage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.verified_reside_resident_id IS NOT NULL AND (
    OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR (OLD.verified_reside_resident_id IS DISTINCT FROM NEW.verified_reside_resident_id
      AND NOT (NEW.verified_reside_resident_id IS NULL AND NEW.anonymized_at IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'verified resident attribution cannot be reassigned';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER identities_keep_verified_reside_linkage
BEFORE UPDATE OF tenant_id, verified_reside_resident_id ON identities
FOR EACH ROW EXECUTE FUNCTION keep_verified_reside_identity_linkage();
