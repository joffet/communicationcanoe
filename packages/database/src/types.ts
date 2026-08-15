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
  live_transfers: TableDef<LiveTransferRow, LiveTransferInsert>;
  identity_conversion_logs: TableDef<IdentityConversionLogRow, IdentityConversionLogInsert>;
  outbound_batches: TableDef<OutboundBatchRow, OutboundBatchInsert>;
  outbound_batch_recipients: TableDef<OutboundBatchRecipientRow, OutboundBatchRecipientInsert>;
  tags: TableDef<TagRow, TagInsert>;
  conversation_tags: TableDef<ConversationTagRow, ConversationTagInsert>;
  conversation_assignees: TableDef<ConversationAssigneeRow, ConversationAssigneeInsert>;
  conversation_read_states: TableDef<ConversationReadStateRow, ConversationReadStateInsert>;
  conversation_personal_tags: TableDef<ConversationPersonalTagRow, ConversationPersonalTagInsert>;
  conversation_participants: TableDef<ConversationParticipantRow, ConversationParticipantInsert>;
  conversation_splits: TableDef<ConversationSplitRow, ConversationSplitInsert>;
  documents: TableDef<DocumentRow, DocumentInsert>;
  document_chunks: TableDef<DocumentChunkRow, DocumentChunkInsert>;
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
  identity_merge_chain_ids: { Args: { p_identity_id: string }; Returns: string[] };
  resolve_conversation_id: { Args: { p_conversation_id: string }; Returns: string };
  conversation_merge_chain_ids: { Args: { p_conversation_id: string }; Returns: string[] };
  match_document_chunks: {
    Args: { p_tenant_id: string; p_query_embedding: number[]; p_match_count: number };
    Returns: Array<{ id: string; document_id: string; heading: string | null; content: string; distance: number }>;
  };
};

export type Database = {
  public: DefaultSchema;
};

export type TenantProvisioningSource = "manual" | "reside";

export type TenantRow = {
  id: string;
  name: string;
  twilio_number: string;
  inbound_email_address: string;
  chat_widget_key: string;
  provisioning_source: TenantProvisioningSource;
  /** reside's own client identifier - may be a slug (e.g. "cardiff"), not just a
   * UUID. This is what reside sends inbound and expects echoed back outbound;
   * `id` above is comm-canoe's internal key that every tenant_id FK points at.
   * The two are equal only for tenants provisioned before they were decoupled. */
  reside_client_uid: string;
  created_at: string;
};

export type TenantInsert = {
  id?: string;
  name: string;
  twilio_number: string;
  inbound_email_address: string;
  chat_widget_key?: string;
  provisioning_source?: TenantProvisioningSource;
  reside_client_uid: string;
  created_at?: string;
};

export type TenantSettingsRow = {
  tenant_id: string;
  greeting_message: string | null;
  business_hours: Json;
  faq_snippets: Json;
  auto_reply_sms: boolean;
  bounce_threshold: number;
  external_send_delay_seconds: number;
  default_response_window_minutes: number;
  conversation_staleness_minutes: number;
  max_knowledge_documents: number;
  max_knowledge_chunks: number;
  updated_at: string;
};

export type TenantSettingsInsert = {
  tenant_id: string;
  greeting_message?: string | null;
  business_hours?: Json;
  faq_snippets?: Json;
  auto_reply_sms?: boolean;
  bounce_threshold?: number;
  external_send_delay_seconds?: number;
  default_response_window_minutes?: number;
  conversation_staleness_minutes?: number;
  max_knowledge_documents?: number;
  max_knowledge_chunks?: number;
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
  is_anonymous: boolean;
  merged_into_id: string | null;
  reside_resident_id: string | null;
  email_consecutive_failures: number;
  phone_consecutive_failures: number;
  email_flagged_at: string | null;
  phone_flagged_at: string | null;
  created_at: string;
};

export type IdentityInsert = {
  id?: string;
  tenant_id: string;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  is_anonymous?: boolean;
  merged_into_id?: string | null;
  reside_resident_id?: string | null;
  email_consecutive_failures?: number;
  phone_consecutive_failures?: number;
  email_flagged_at?: string | null;
  phone_flagged_at?: string | null;
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

export type ConversationPriority = "low" | "normal" | "high" | "urgent";

export type ConversationRow = {
  id: string;
  tenant_id: string;
  identity_id: string;
  status: "open" | "pending" | "resolved" | "merged";
  assigned_team_id: string | null;
  assigned_user_id: string | null;
  summary: string | null;
  priority: ConversationPriority;
  response_due_at: string | null;
  response_overdue_notified_at: string | null;
  merged_into_id: string | null;
  created_at: string;
  last_message_at: string;
};

export type ConversationInsert = {
  id?: string;
  tenant_id: string;
  identity_id: string;
  status?: "open" | "pending" | "resolved" | "merged";
  assigned_team_id?: string | null;
  assigned_user_id?: string | null;
  summary?: string | null;
  priority?: ConversationPriority;
  response_due_at?: string | null;
  response_overdue_notified_at?: string | null;
  merged_into_id?: string | null;
  created_at?: string;
  last_message_at?: string;
};

export type MessageDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "canceled";
export type MessageVisibility = "internal" | "external";
export type MessageAiReviewStatus = "pending" | "approved" | "flagged";
export type MessageTopicCheckStatus = "pending" | "processing" | "reviewed";
export type MessageTranscriptionStatus = "pending" | "ready" | "failed";

export type MessageRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  direction: "inbound" | "outbound";
  sender_type: "external" | "internal_user" | "ai_agent" | "system";
  sender_id: string | null;
  body: string;
  subject: string | null;
  audio_url: string | null;
  transcript: string | null;
  ai_summary: string | null;
  provider_message_id: string | null;
  delivery_status: MessageDeliveryStatus | null;
  delivery_error: string | null;
  delivery_attempts: number;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  visibility: MessageVisibility;
  scheduled_send_at: string | null;
  ai_review_status: MessageAiReviewStatus | null;
  ai_review_reasoning: string | null;
  topic_check_status: MessageTopicCheckStatus | null;
  transcription_status: MessageTranscriptionStatus | null;
  transcription_failure_reason: string | null;
  created_at: string;
};

export type MessageInsert = {
  id?: string;
  tenant_id: string;
  conversation_id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  direction: "inbound" | "outbound";
  sender_type: "external" | "internal_user" | "ai_agent" | "system";
  sender_id?: string | null;
  body?: string;
  subject?: string | null;
  audio_url?: string | null;
  transcript?: string | null;
  ai_summary?: string | null;
  provider_message_id?: string | null;
  delivery_status?: MessageDeliveryStatus | null;
  delivery_error?: string | null;
  delivery_attempts?: number;
  sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  visibility?: MessageVisibility;
  scheduled_send_at?: string | null;
  ai_review_status?: MessageAiReviewStatus | null;
  ai_review_reasoning?: string | null;
  topic_check_status?: MessageTopicCheckStatus | null;
  transcription_status?: MessageTranscriptionStatus | null;
  transcription_failure_reason?: string | null;
  created_at?: string;
};

export type LiveTransferRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  message_id: string | null;
  channel: "voice" | "web_chat";
  attempted_user_id: string | null;
  outcome: "pending" | "answered" | "no_answer" | "declined";
  created_at: string;
};

export type LiveTransferInsert = {
  id?: string;
  tenant_id: string;
  conversation_id: string;
  message_id?: string | null;
  channel?: "voice" | "web_chat";
  attempted_user_id?: string | null;
  outcome: "pending" | "answered" | "no_answer" | "declined";
  created_at?: string;
};

export type IdentityConversionLogRow = {
  id: string;
  tenant_id: string;
  identity_id: string;
  converted_at: string;
  converted_by: "system" | "user";
  converted_by_user_id: string | null;
  captured_name: string | null;
  captured_email: string | null;
  captured_phone: string | null;
};

export type IdentityConversionLogInsert = {
  id?: string;
  tenant_id: string;
  identity_id: string;
  converted_at?: string;
  converted_by?: "system" | "user";
  converted_by_user_id?: string | null;
  captured_name?: string | null;
  captured_email?: string | null;
  captured_phone?: string | null;
};

export type OutboundBatchStatus = "pending" | "processing" | "completed";

export type OutboundBatchRow = {
  id: string;
  tenant_id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  subject: string | null;
  status: OutboundBatchStatus;
  total_recipients: number;
  completed_recipients: number;
  created_at: string;
  completed_at: string | null;
};

export type OutboundBatchInsert = {
  id?: string;
  tenant_id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  subject?: string | null;
  status?: OutboundBatchStatus;
  total_recipients: number;
  completed_recipients?: number;
  created_at?: string;
  completed_at?: string | null;
};

export type OutboundBatchRecipientStatus = "pending" | "sent" | "failed";

export type OutboundBatchRecipientRow = {
  id: string;
  batch_id: string;
  tenant_id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  identity_contact: Json;
  body: string;
  status: OutboundBatchRecipientStatus;
  message_id: string | null;
  error: string | null;
  created_at: string;
};

export type OutboundBatchRecipientInsert = {
  id?: string;
  batch_id: string;
  tenant_id: string;
  channel: "voice" | "sms" | "email" | "web_chat";
  identity_contact: Json;
  body: string;
  status?: OutboundBatchRecipientStatus;
  message_id?: string | null;
  error?: string | null;
  created_at?: string;
};

export type TagRow = {
  id: string;
  tenant_id: string;
  name: string;
  color: string | null;
  created_at: string;
};

export type TagInsert = {
  id?: string;
  tenant_id: string;
  name: string;
  color?: string | null;
  created_at?: string;
};

export type ConversationTagRow = {
  conversation_id: string;
  tag_id: string;
  created_at: string;
};

export type ConversationTagInsert = {
  conversation_id: string;
  tag_id: string;
  created_at?: string;
};

export type ConversationAssigneeRow = {
  conversation_id: string;
  user_id: string;
  assigned_at: string;
  assigned_by: string | null;
};

export type ConversationAssigneeInsert = {
  conversation_id: string;
  user_id: string;
  assigned_at?: string;
  assigned_by?: string | null;
};

export type ConversationReadStateRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  last_read_message_id: string | null;
};

export type ConversationReadStateInsert = {
  conversation_id: string;
  user_id: string;
  last_read_at?: string;
  last_read_message_id?: string | null;
};

export type ConversationPersonalTagRow = {
  conversation_id: string;
  user_id: string;
  created_at: string;
};

export type ConversationPersonalTagInsert = {
  conversation_id: string;
  user_id: string;
  created_at?: string;
};

export type ConversationParticipantRow = {
  id: string;
  conversation_id: string;
  identity_id: string | null;
  user_id: string | null;
  role: "external" | "internal";
  created_at: string;
};

export type ConversationParticipantInsert = {
  id?: string;
  conversation_id: string;
  identity_id?: string | null;
  user_id?: string | null;
  role: "external" | "internal";
  created_at?: string;
};

export type ConversationSplitRow = {
  id: string;
  tenant_id: string;
  source_conversation_id: string;
  target_conversation_id: string;
  split_message_id: string | null;
  trigger_type: "admin" | "ai";
  triggered_by_user_id: string | null;
  reasoning: string | null;
  created_at: string;
};

export type ConversationSplitInsert = {
  id?: string;
  tenant_id: string;
  source_conversation_id: string;
  target_conversation_id: string;
  split_message_id?: string | null;
  trigger_type: "admin" | "ai";
  triggered_by_user_id?: string | null;
  reasoning?: string | null;
  created_at?: string;
};

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export type DocumentRow = {
  id: string;
  tenant_id: string;
  filename: string;
  content_text: string;
  extractor: string;
  page_count: number | null;
  status: DocumentStatus;
  failure_reason: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentInsert = {
  id?: string;
  tenant_id: string;
  filename: string;
  content_text: string;
  extractor: string;
  page_count?: number | null;
  status?: DocumentStatus;
  failure_reason?: string | null;
  uploaded_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

// embedding is typed as number[] here (pgvector's `vector` column round-trips
// as a plain array through the JS client) even though the caller may omit it
// - a chunk row is always inserted with its embedding already computed, but
// Insert still marks it optional since Postgres would otherwise allow NULL.
export type DocumentChunkRow = {
  id: string;
  document_id: string;
  tenant_id: string;
  chunk_index: number;
  heading: string | null;
  content: string;
  embedding: number[] | null;
  created_at: string;
};

export type DocumentChunkInsert = {
  id?: string;
  document_id: string;
  tenant_id: string;
  chunk_index: number;
  heading?: string | null;
  content: string;
  embedding?: number[] | null;
  created_at?: string;
};

export type Tables<T extends keyof DatabaseTables> = DatabaseTables[T]["Row"];

export type Tenant = TenantRow;
export type Identity = IdentityRow;
export type Conversation = ConversationRow;
export type Message = MessageRow;
export type Team = TeamRow;
export type LiveTransfer = LiveTransferRow;
export type IdentityConversionLog = IdentityConversionLogRow;
export type OutboundBatch = OutboundBatchRow;
export type OutboundBatchRecipient = OutboundBatchRecipientRow;
export type Tag = TagRow;
export type ConversationAssignee = ConversationAssigneeRow;
export type ConversationReadState = ConversationReadStateRow;
export type ConversationPersonalTag = ConversationPersonalTagRow;
export type ConversationParticipant = ConversationParticipantRow;
export type Document = DocumentRow;
export type DocumentChunk = DocumentChunkRow;

/** Everyone else on the thread besides the primary `identity`/`assigned_user_id`
 * - additive per Phase 2's design (see conversation_participants migration),
 * never breaks the single-`identity` assumption existing consumers rely on.
 * `participants` is the raw join rows (not resolved Identity[]) since a
 * participant can be external (identity_id) OR internal (user_id) - callers
 * resolve whichever side they need. */
export type ConversationExtras = {
  participants: ConversationParticipant[];
  tags: Tag[];
  assignees: ConversationAssignee[];
};

export type ConversationWithIdentity = Conversation & {
  identity: Identity;
} & ConversationExtras;

/** Per-viewer enrichment (Reside dashboard unread/relevance) - computed
 * relative to a single resolved viewer user id, never batched across all
 * tenant admins the way ConversationExtras is, since it's meaningless
 * without a specific viewer in mind. Kept out of ConversationExtras/
 * ConversationWithIdentity so every existing call site (comm-canoe's own
 * dashboard, the resident-facing member endpoints) is unaffected - only the
 * reside conversations list route opts in by passing a viewerUserId. */
export type ConversationViewerState = {
  viewer_is_relevant: boolean;
  viewer_has_unread: boolean;
  viewer_last_read_at: string | null;
};

export type ConversationThread = Conversation & {
  identity: Identity;
  messages: Message[];
} & ConversationExtras;
