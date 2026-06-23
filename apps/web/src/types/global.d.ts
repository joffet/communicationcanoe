/**
 * Ambient types for apps/web — no import required.
 *
 * Conventions:
 * - New domain types → add to the package first, then one alias line here.
 * - New app-wide types → alias or define here.
 * - Component-only props → stay local unless used in 3+ files.
 */

declare global {
  // @communication-canoe/database — types.ts
  type Json = import("@communication-canoe/database").Json;
  type Database = import("@communication-canoe/database").Database;
  type TenantRow = import("@communication-canoe/database").TenantRow;
  type TenantInsert = import("@communication-canoe/database").TenantInsert;
  type TenantSettingsRow = import("@communication-canoe/database").TenantSettingsRow;
  type TenantSettingsInsert = import("@communication-canoe/database").TenantSettingsInsert;
  type PlatformRole = import("@communication-canoe/database").PlatformRole;
  type UserRow = import("@communication-canoe/database").UserRow;
  type UserInsert = import("@communication-canoe/database").UserInsert;
  type UserTenantMembershipRow = import("@communication-canoe/database").UserTenantMembershipRow;
  type UserTenantMembershipInsert =
    import("@communication-canoe/database").UserTenantMembershipInsert;
  type TeamRow = import("@communication-canoe/database").TeamRow;
  type TeamInsert = import("@communication-canoe/database").TeamInsert;
  type TeamMembershipRow = import("@communication-canoe/database").TeamMembershipRow;
  type TeamMembershipInsert = import("@communication-canoe/database").TeamMembershipInsert;
  type IdentityRow = import("@communication-canoe/database").IdentityRow;
  type IdentityInsert = import("@communication-canoe/database").IdentityInsert;
  type IdentityMergeLogRow = import("@communication-canoe/database").IdentityMergeLogRow;
  type IdentityMergeLogInsert = import("@communication-canoe/database").IdentityMergeLogInsert;
  type ConversationRow = import("@communication-canoe/database").ConversationRow;
  type ConversationInsert = import("@communication-canoe/database").ConversationInsert;
  type MessageRow = import("@communication-canoe/database").MessageRow;
  type MessageInsert = import("@communication-canoe/database").MessageInsert;
  type LiveTransferRow = import("@communication-canoe/database").LiveTransferRow;
  type LiveTransferInsert = import("@communication-canoe/database").LiveTransferInsert;
  type IdentityConversionLogRow =
    import("@communication-canoe/database").IdentityConversionLogRow;
  type IdentityConversionLogInsert =
    import("@communication-canoe/database").IdentityConversionLogInsert;
  type Tables<T extends keyof Database["public"]["Tables"]> =
    import("@communication-canoe/database").Tables<T>;
  type Tenant = import("@communication-canoe/database").Tenant;
  type Identity = import("@communication-canoe/database").Identity;
  type Conversation = import("@communication-canoe/database").Conversation;
  type Message = import("@communication-canoe/database").Message;
  type Team = import("@communication-canoe/database").Team;
  type LiveTransfer = import("@communication-canoe/database").LiveTransfer;
  type IdentityConversionLog = import("@communication-canoe/database").IdentityConversionLog;
  type ConversationWithIdentity = import("@communication-canoe/database").ConversationWithIdentity;
  type ConversationThread = import("@communication-canoe/database").ConversationThread;

  // @communication-canoe/database — client & services
  type AppSupabaseClient = import("@communication-canoe/database").AppSupabaseClient;
  type AdminTenantRow = import("@communication-canoe/database").AdminTenantRow;
  type AdminUserMembershipSummary =
    import("@communication-canoe/database").AdminUserMembershipSummary;
  type AdminUserRow = import("@communication-canoe/database").AdminUserRow;
  type UserMembershipInput = import("@communication-canoe/database").UserMembershipInput;
  type ChatSessionPayload = import("@communication-canoe/database").ChatSessionPayload;

  // @communication-canoe/shared — constants
  type ConversationStatus = import("@communication-canoe/shared/constants").ConversationStatus;
  type MessageChannel = import("@communication-canoe/shared/constants").MessageChannel;
  type MessageDirection = import("@communication-canoe/shared/constants").MessageDirection;
  type SenderType = import("@communication-canoe/shared/constants").SenderType;
  type LiveTransferChannel = import("@communication-canoe/shared/constants").LiveTransferChannel;
  type LiveTransferOutcome = import("@communication-canoe/shared/constants").LiveTransferOutcome;

  // @communication-canoe/shared — schemas
  type AppendMessageInput = import("@communication-canoe/shared/schemas").AppendMessageInput;
  type IdentityContact = import("@communication-canoe/shared/schemas").IdentityContact;
  type AnonymousIdentityInput = import("@communication-canoe/shared/schemas").AnonymousIdentityInput;
  type ConvertIdentityInput = import("@communication-canoe/shared/schemas").ConvertIdentityInput;
  type LogLiveTransferInput = import("@communication-canoe/shared/schemas").LogLiveTransferInput;
  type ConversationFilters = import("@communication-canoe/shared/schemas").ConversationFilters;

  // @communication-canoe/shared — realtime
  type RealtimeMode = import("@communication-canoe/shared/realtime").RealtimeMode;
  type RealtimeToolDefinition = import("@communication-canoe/shared/realtime").RealtimeToolDefinition;
  type TransferToHumanArgs = import("@communication-canoe/shared/realtime").TransferToHumanArgs;
  type CaptureContactInfoArgs = import("@communication-canoe/shared/realtime").CaptureContactInfoArgs;
  type ChatWidgetInitMessage = import("@communication-canoe/shared/realtime").ChatWidgetInitMessage;
  type ChatWidgetClientMessage = import("@communication-canoe/shared/realtime").ChatWidgetClientMessage;
  type ChatWidgetServerMessage = import("@communication-canoe/shared/realtime").ChatWidgetServerMessage;
  type ChatBroadcastNeedsHuman = import("@communication-canoe/shared/realtime").ChatBroadcastNeedsHuman;
  type ChatBroadcastHandoffState =
    import("@communication-canoe/shared/realtime").ChatBroadcastHandoffState;
  type ChatBroadcastMessage = import("@communication-canoe/shared/realtime").ChatBroadcastMessage;
  type ChatBroadcastTyping = import("@communication-canoe/shared/realtime").ChatBroadcastTyping;
  type HandoffJoinRequest = import("@communication-canoe/shared/realtime").HandoffJoinRequest;
  type AgentMessageRequest = import("@communication-canoe/shared/realtime").AgentMessageRequest;

  // @communication-canoe/shared — ai
  type AiMessage = import("@communication-canoe/shared/ai").AiMessage;
  type AiCompletionRequest = import("@communication-canoe/shared/ai").AiCompletionRequest;
  type AiProvider = import("@communication-canoe/shared/ai").AiProvider;
  type RouteConversationInput = import("@communication-canoe/shared/ai").RouteConversationInput;
  type RouteConversationResult = import("@communication-canoe/shared/ai").RouteConversationResult;
  type SummarizeConversationInput =
    import("@communication-canoe/shared/ai").SummarizeConversationInput;
  type SuggestReplyInput = import("@communication-canoe/shared/ai").SuggestReplyInput;

  // App-local
  type AppSession = NonNullable<
    Awaited<ReturnType<typeof import("@/lib/auth/session").requireSession>>
  >;

  // Shared admin list helpers
  type SortConfig<TField extends string> = {
    field: TField;
    direction: "asc" | "desc";
  };

  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_SUPABASE_URL: string;
      NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
      SUPABASE_SERVICE_ROLE_KEY: string;
      DATABASE_URL: string;
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
      TWILIO_ACCOUNT_SID?: string;
      TWILIO_AUTH_TOKEN?: string;
      POSTMARK_INBOUND_WEBHOOK_SECRET?: string;
      AI_PROVIDER?: string;
      OPENAI_API_KEY?: string;
      ANTHROPIC_API_KEY?: string;
      INTERNAL_API_SECRET?: string;
      REALTIME_BRIDGE_URL?: string;
      CHAT_SESSION_SECRET?: string;
      REALTIME_BRIDGE_PORT?: string;
      REALTIME_BRIDGE_PUBLIC_WS_URL?: string;
      CHAT_HANDOFF_TIMEOUT_MS?: string;
      CHAT_SESSION_TTL_MS?: string;
      NEXT_PUBLIC_CHAT_WIDGET_URL?: string;
      NEXT_PUBLIC_APP_URL?: string;
      SUPER_ADMIN_EMAILS?: string;
      EMAIL_ASSET_BASE_URL?: string;
      AMAZON_SES_REGION?: string;
      AWS_REGION?: string;
      AWS_ACCESS_KEY_ID?: string;
      AWS_SECRET_ACCESS_KEY?: string;
      DEFAULT_MAIL_FROM?: string;
      VOICE_BRIDGE_URL?: string;
      PORT?: string;
    }
  }
}

export {};
