-- Messages sent server-to-server by reside (not customer, staff, or AI originated)
ALTER TYPE sender_type ADD VALUE IF NOT EXISTS 'system';

-- Cross-system link: comm-canoe identity -> reside resident record
ALTER TABLE identities ADD COLUMN IF NOT EXISTS reside_resident_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS identities_tenant_reside_resident_unique
  ON identities (tenant_id, reside_resident_id) WHERE reside_resident_id IS NOT NULL;

-- Provenance: distinguish reside-provisioned tenants from manual/super-admin ones
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioning_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_provisioning_source_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_provisioning_source_check
  CHECK (provisioning_source IN ('manual', 'reside'));
