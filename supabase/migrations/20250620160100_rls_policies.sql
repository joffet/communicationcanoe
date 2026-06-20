-- Enable RLS on all tenant-scoped tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_merge_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transfers ENABLE ROW LEVEL SECURITY;

-- Users: read/update own profile
CREATE POLICY users_select_own ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY users_update_own ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Tenants: members can read their tenants
CREATE POLICY tenants_select_member ON tenants
  FOR SELECT TO authenticated
  USING (id IN (SELECT get_user_tenant_ids()));

-- Tenant settings
CREATE POLICY tenant_settings_select_member ON tenant_settings
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY tenant_settings_update_admin ON tenant_settings
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenant_memberships
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Memberships
CREATE POLICY user_tenant_memberships_select ON user_tenant_memberships
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY team_memberships_select ON team_memberships
  FOR SELECT TO authenticated
  USING (
    team_id IN (
      SELECT t.id FROM teams t
      WHERE t.tenant_id IN (SELECT get_user_tenant_ids())
    )
  );

-- Teams
CREATE POLICY teams_select_member ON teams
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Identities
CREATE POLICY identities_select_member ON identities
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY identities_update_member ON identities
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Identity merge logs
CREATE POLICY identity_merge_logs_select ON identity_merge_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Conversations
CREATE POLICY conversations_select_member ON conversations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY conversations_update_member ON conversations
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Messages
CREATE POLICY messages_select_member ON messages
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY messages_insert_member ON messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

-- Call transfers
CREATE POLICY call_transfers_select_member ON call_transfers
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Realtime publication for inbox
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
