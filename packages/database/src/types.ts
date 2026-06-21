export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type DefaultSchema = {
  Tables: DatabaseTables;
  Views: Record<string, never>;
  Functions: DatabaseFunctions;
  Enums: Record<string, never>;
  CompositeTypes: Record<string, never>;
};

type DatabaseTables = {
  tenants: TableDef<TenantRow, TenantInsert>;
  tenant_settings: TableDef<TenantSettingsRow, TenantSettingsInsert>;
  users: TableDef<UserRow, UserInsert>;
  user_tenant_memberships: TableDef<UserTenantMembershipRow, UserTenantMembershipInsert>;
  teams: TableDef<TeamRow, TeamInsert>;
  team_memberships: TableDef<TeamMembershipRow, TeamMembershipInsert>;
  identities: TableDef<IdentityRow, IdentityInsert>;
  identity_merge_logs: TableDef<IdentityMergeLogRow, IdentityMergeLogInsert>;
  conversations: TableDef<ConversationRow, ConversationInsert>;
  messages: TableDef<MessageRow, MessageInsert>;
  call_transfers: TableDef<CallTransferRow, CallTransferInsert>;
};

type TableDef<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

type DatabaseFunctions = {
  get_user_tenant_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
  resolve_identity_id: { Args: { p_identity_id: string }; Returns: string };
};

export type Database = {
  public: DefaultSchema;
};

export type TenantRow = {
  id: string;
  name: string;
  twilio_number: string;
  inbound_email_address: string;
  created_at: string;
};

export type TenantInsert = {
  id?: string;
  name: string;
  twilio_number: string;
  inbound_email_address: string;
  created_at?: string;
};

export type TenantSettingsRow = {
  tenant_id: string;
  greeting_message: string | null;
  business_hours: Json;
  faq_snippets: Json;
  auto_reply_sms: boolean;
  updated_at: string;
};

export type TenantSettingsInsert = {
  tenant_id: string;
  greeting_message?: string | null;
  business_hours?: Json;
  faq_snippets?: Json;
  auto_reply_sms?: boolean;
  updated_at?: string;
};

export type PlatformRole = "user" | "super_admin";

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  phone_number: string | null;
  available_for_calls: boolean;
  platform_role: PlatformRole;
  created_at: string;
};

export type UserInsert = {
  id: string;
  name?: string | null;
  email: string;
  phone_number?: string | null;
  available_for_calls?: boolean;
  platform_role?: PlatformRole;
  created_at?: string;
};

export type UserTenantMembershipRow = {
  user_id: string;
  tenant_id: string;
  role: "admin" | "member";
  created_at: string;
};

export type UserTenantMembershipInsert = {
  user_id: string;
  tenant_id: string;
  role?: "admin" | "member";
  created_at?: string;
};

export type TeamRow = {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
};

export type TeamInsert = {
  id?: string;
  tenant_id: string;
  name: string;
  created_at?: string;
};

export type TeamMembershipRow = {
  user_id: string;
  team_id: string;
  role: "lead" | "member";
  is_on_call: boolean;
};

export type TeamMembershipInsert = {
  user_id: string;
  team_id: string;
  role?: "lead" | "member";
  is_on_call?: boolean;
};

export type IdentityRow = {
  id: string;
  tenant_id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  merged_into_id: string | null;
  created_at: string;
};

export type IdentityInsert = {
  id?: string;
  tenant_id: string;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  merged_into_id?: string | null;
  created_at?: string;
};

export type IdentityMergeLogRow = {
  id: string;
  tenant_id: string;
  identity_a_id: string;
  identity_b_id: string;
  matched_on: "phone" | "email";
  merged_at: string;
  merged_by: "system" | "user";
  merged_by_user_id: string | null;
  unmerged_at: string | null;
};

export type IdentityMergeLogInsert = {
  id?: string;
  tenant_id: string;
  identity_a_id: string;
  identity_b_id: string;
  matched_on: "phone" | "email";
  merged_at?: string;
  merged_by?: "system" | "user";
  merged_by_user_id?: string | null;
  unmerged_at?: string | null;
};

export type ConversationRow = {
  id: string;
  tenant_id: string;
  identity_id: string;
  status: "open" | "pending" | "resolved";
  assigned_team_id: string | null;
  assigned_user_id: string | null;
  summary: string | null;
  created_at: string;
  last_message_at: string;
};

export type ConversationInsert = {
  id?: string;
  tenant_id: string;
  identity_id: string;
  status?: "open" | "pending" | "resolved";
  assigned_team_id?: string | null;
  assigned_user_id?: string | null;
  summary?: string | null;
  created_at?: string;
  last_message_at?: string;
};

export type MessageRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel: "voice" | "sms" | "email";
  direction: "inbound" | "outbound";
  sender_type: "external" | "internal_user" | "ai_agent";
  sender_id: string | null;
  body: string;
  subject: string | null;
  audio_url: string | null;
  transcript: string | null;
  ai_summary: string | null;
  created_at: string;
};

export type MessageInsert = {
  id?: string;
  tenant_id: string;
  conversation_id: string;
  channel: "voice" | "sms" | "email";
  direction: "inbound" | "outbound";
  sender_type: "external" | "internal_user" | "ai_agent";
  sender_id?: string | null;
  body?: string;
  subject?: string | null;
  audio_url?: string | null;
  transcript?: string | null;
  ai_summary?: string | null;
  created_at?: string;
};

export type CallTransferRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  message_id: string | null;
  attempted_user_id: string;
  outcome: "answered" | "no_answer" | "declined";
  created_at: string;
};

export type CallTransferInsert = {
  id?: string;
  tenant_id: string;
  conversation_id: string;
  message_id?: string | null;
  attempted_user_id: string;
  outcome: "answered" | "no_answer" | "declined";
  created_at?: string;
};

export type Tables<T extends keyof DatabaseTables> = DatabaseTables[T]["Row"];

export type Tenant = TenantRow;
export type Identity = IdentityRow;
export type Conversation = ConversationRow;
export type Message = MessageRow;
export type Team = TeamRow;

export type ConversationWithIdentity = Conversation & {
  identity: Identity;
};

export type ConversationThread = Conversation & {
  identity: Identity;
  messages: Message[];
};
