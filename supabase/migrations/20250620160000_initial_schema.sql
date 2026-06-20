-- Core enums
CREATE TYPE conversation_status AS ENUM ('open', 'pending', 'resolved');
CREATE TYPE message_channel AS ENUM ('voice', 'sms', 'email');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE sender_type AS ENUM ('external', 'internal_user', 'ai_agent');
CREATE TYPE merge_matched_on AS ENUM ('phone', 'email');
CREATE TYPE merge_actor AS ENUM ('system', 'user');
CREATE TYPE call_transfer_outcome AS ENUM ('answered', 'no_answer', 'declined');
CREATE TYPE tenant_role AS ENUM ('admin', 'member');
CREATE TYPE team_role AS ENUM ('lead', 'member');

-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  twilio_number TEXT NOT NULL,
  inbound_email_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_twilio_number_unique UNIQUE (twilio_number),
  CONSTRAINT tenants_inbound_email_unique UNIQUE (inbound_email_address)
);

CREATE INDEX tenants_twilio_number_idx ON tenants (twilio_number);
CREATE INDEX tenants_inbound_email_idx ON tenants (inbound_email_address);

-- Tenant settings
CREATE TABLE tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  greeting_message TEXT,
  business_hours JSONB DEFAULT '{}'::jsonb,
  faq_snippets JSONB DEFAULT '[]'::jsonb,
  auto_reply_sms BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Internal user profiles (linked to auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  name TEXT,
  email TEXT NOT NULL,
  phone_number TEXT,
  available_for_calls BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_email_idx ON users (email);

-- User ↔ tenant membership
CREATE TABLE user_tenant_memberships (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role tenant_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX user_tenant_memberships_tenant_idx ON user_tenant_memberships (tenant_id);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teams_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX teams_tenant_idx ON teams (tenant_id);

-- Team membership
CREATE TABLE team_memberships (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  role team_role NOT NULL DEFAULT 'member',
  is_on_call BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX team_memberships_team_idx ON team_memberships (team_id);

-- Identities (customers)
CREATE TABLE identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  phone TEXT,
  email TEXT,
  name TEXT,
  merged_into_id UUID REFERENCES identities (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT identities_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT identities_no_self_merge CHECK (merged_into_id IS DISTINCT FROM id)
);

CREATE INDEX identities_tenant_idx ON identities (tenant_id);
CREATE UNIQUE INDEX identities_tenant_phone_unique ON identities (tenant_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX identities_tenant_email_unique ON identities (tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX identities_merged_into_idx ON identities (merged_into_id) WHERE merged_into_id IS NOT NULL;

-- Identity merge audit log
CREATE TABLE identity_merge_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  identity_a_id UUID NOT NULL REFERENCES identities (id) ON DELETE CASCADE,
  identity_b_id UUID NOT NULL REFERENCES identities (id) ON DELETE CASCADE,
  matched_on merge_matched_on NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  merged_by merge_actor NOT NULL DEFAULT 'system',
  merged_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  unmerged_at TIMESTAMPTZ
);

CREATE INDEX identity_merge_logs_tenant_idx ON identity_merge_logs (tenant_id);

-- Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  identity_id UUID NOT NULL REFERENCES identities (id) ON DELETE CASCADE,
  status conversation_status NOT NULL DEFAULT 'open',
  assigned_team_id UUID REFERENCES teams (id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX conversations_tenant_last_message_idx ON conversations (tenant_id, last_message_at DESC);
CREATE INDEX conversations_identity_idx ON conversations (identity_id);
CREATE UNIQUE INDEX conversations_one_open_per_identity ON conversations (tenant_id, identity_id) WHERE status = 'open';

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  channel message_channel NOT NULL,
  direction message_direction NOT NULL,
  sender_type sender_type NOT NULL,
  sender_id UUID,
  body TEXT NOT NULL DEFAULT '',
  subject TEXT,
  audio_url TEXT,
  transcript TEXT,
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_created_idx ON messages (conversation_id, created_at);
CREATE INDEX messages_tenant_idx ON messages (tenant_id);

-- Call transfer attempts
CREATE TABLE call_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
  attempted_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  outcome call_transfer_outcome NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_transfers_tenant_idx ON call_transfers (tenant_id);
CREATE INDEX call_transfers_conversation_idx ON call_transfers (conversation_id);

-- Resolve canonical identity (follow merge chain)
CREATE OR REPLACE FUNCTION resolve_identity_id(p_identity_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_id UUID := p_identity_id;
  next_id UUID;
BEGIN
  LOOP
    SELECT merged_into_id INTO next_id FROM identities WHERE id = current_id;
    EXIT WHEN next_id IS NULL;
    current_id := next_id;
  END LOOP;
  RETURN current_id;
END;
$$;

-- Helper: tenant IDs for current auth user
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM user_tenant_memberships
  WHERE user_id = auth.uid();
$$;

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Update conversation last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation_timestamp
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message_at();
