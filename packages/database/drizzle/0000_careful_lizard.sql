CREATE TYPE "public"."conversation_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'pending', 'resolved', 'merged');--> statement-breakpoint
CREATE TYPE "public"."live_transfer_channel" AS ENUM('voice', 'web_chat');--> statement-breakpoint
CREATE TYPE "public"."live_transfer_outcome" AS ENUM('answered', 'no_answer', 'declined', 'pending');--> statement-breakpoint
CREATE TYPE "public"."merge_actor" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TYPE "public"."merge_matched_on" AS ENUM('phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('voice', 'sms', 'email', 'web_chat');--> statement-breakpoint
CREATE TYPE "public"."message_delivery_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'undelivered', 'sending', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_visibility" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('user', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."sender_type" AS ENUM('external', 'internal_user', 'ai_agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TYPE "public"."tenant_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "conversation_assignees" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "conversation_assignees_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"identity_id" uuid,
	"user_id" uuid,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_role_check" CHECK ("conversation_participants"."role" in ('external', 'internal')),
	CONSTRAINT "conversation_participants_check" CHECK (("conversation_participants"."identity_id" is not null) <> ("conversation_participants"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "conversation_personal_tags" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_personal_tags_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_read_states" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_message_id" uuid,
	CONSTRAINT "conversation_read_states_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"target_conversation_id" uuid NOT NULL,
	"split_message_id" uuid,
	"trigger_type" text NOT NULL,
	"triggered_by_user_id" uuid,
	"reasoning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_splits_trigger_type_check" CHECK ("conversation_splits"."trigger_type" in ('admin', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "conversation_tags" (
	"conversation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tags_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"assigned_team_id" uuid,
	"assigned_user_id" uuid,
	"summary" text,
	"priority" "conversation_priority" DEFAULT 'normal' NOT NULL,
	"response_due_at" timestamp with time zone,
	"response_overdue_notified_at" timestamp with time zone,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_text" text NOT NULL,
	"extractor" text NOT NULL,
	"page_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('pending', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text,
	"email" text,
	"name" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"reside_resident_id" uuid,
	"email_consecutive_failures" integer DEFAULT 0 NOT NULL,
	"phone_consecutive_failures" integer DEFAULT 0 NOT NULL,
	"email_flagged_at" timestamp with time zone,
	"phone_flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identities_contact_required" CHECK ("identities"."phone" is not null or "identities"."email" is not null or "identities"."is_anonymous" = true),
	CONSTRAINT "identities_no_self_merge" CHECK ("identities"."merged_into_id" is distinct from "identities"."id")
);
--> statement-breakpoint
CREATE TABLE "identity_conversion_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"converted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"converted_by" "merge_actor" DEFAULT 'system' NOT NULL,
	"converted_by_user_id" uuid,
	"captured_name" text,
	"captured_email" text,
	"captured_phone" text
);
--> statement-breakpoint
CREATE TABLE "identity_merge_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_a_id" uuid NOT NULL,
	"identity_b_id" uuid NOT NULL,
	"matched_on" "merge_matched_on" NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_by" "merge_actor" DEFAULT 'system' NOT NULL,
	"merged_by_user_id" uuid,
	"unmerged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "live_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"attempted_user_id" uuid,
	"channel" "live_transfer_channel" DEFAULT 'voice' NOT NULL,
	"outcome" "live_transfer_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"sender_type" "sender_type" NOT NULL,
	"sender_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"subject" text,
	"audio_url" text,
	"transcript" text,
	"ai_summary" text,
	"provider_message_id" text,
	"delivery_status" "message_delivery_status",
	"delivery_error" text,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"visibility" "message_visibility" DEFAULT 'internal' NOT NULL,
	"scheduled_send_at" timestamp with time zone,
	"ai_review_status" text,
	"ai_review_reasoning" text,
	"topic_check_status" text,
	"idempotency_key" text,
	"transcription_status" text,
	"transcription_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_ai_review_status_check" CHECK ("messages"."ai_review_status" in ('pending', 'approved', 'flagged')),
	CONSTRAINT "messages_topic_check_status_check" CHECK ("messages"."topic_check_status" in ('pending', 'processing', 'reviewed')),
	CONSTRAINT "messages_transcription_status_check" CHECK ("messages"."transcription_status" = any (array['pending', 'transcribing', 'ready', 'failed']))
);
--> statement-breakpoint
CREATE TABLE "outbound_batch_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"identity_contact" jsonb NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_batch_recipients_status_check" CHECK ("outbound_batch_recipients"."status" in ('pending', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "outbound_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"subject" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_recipients" integer NOT NULL,
	"completed_recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbound_batches_status_check" CHECK ("outbound_batches"."status" in ('pending', 'processing', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_tenant_id_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"is_on_call" boolean DEFAULT false NOT NULL,
	CONSTRAINT "team_memberships_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"greeting_message" text,
	"business_hours" jsonb DEFAULT '{}'::jsonb,
	"faq_snippets" jsonb DEFAULT '[]'::jsonb,
	"auto_reply_sms" boolean DEFAULT false NOT NULL,
	"bounce_threshold" integer DEFAULT 3 NOT NULL,
	"external_send_delay_seconds" integer DEFAULT 60 NOT NULL,
	"default_response_window_minutes" integer DEFAULT 60 NOT NULL,
	"conversation_staleness_minutes" integer DEFAULT 1440 NOT NULL,
	"max_knowledge_documents" integer DEFAULT 50 NOT NULL,
	"max_knowledge_chunks" integer DEFAULT 5000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"twilio_number" text NOT NULL,
	"inbound_email_address" text NOT NULL,
	"chat_widget_key" text NOT NULL,
	"provisioning_source" text DEFAULT 'manual' NOT NULL,
	"reside_client_uid" text NOT NULL,
	"reside_app_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_twilio_number_unique" UNIQUE("twilio_number"),
	CONSTRAINT "tenants_inbound_email_unique" UNIQUE("inbound_email_address"),
	CONSTRAINT "tenants_chat_widget_key_unique" UNIQUE("chat_widget_key"),
	CONSTRAINT "tenants_reside_client_uid_unique" UNIQUE("reside_client_uid"),
	CONSTRAINT "tenants_provisioning_source_check" CHECK ("tenants"."provisioning_source" in ('manual', 'reside'))
);
--> statement-breakpoint
CREATE TABLE "user_tenant_memberships" (
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "tenant_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tenant_memberships_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"phone_number" text,
	"available_for_calls" boolean DEFAULT false NOT NULL,
	"platform_role" "platform_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_assignees" ADD CONSTRAINT "conversation_assignees_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignees" ADD CONSTRAINT "conversation_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assignees" ADD CONSTRAINT "conversation_assignees_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_personal_tags" ADD CONSTRAINT "conversation_personal_tags_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_personal_tags" ADD CONSTRAINT "conversation_personal_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_last_read_message_id_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_splits" ADD CONSTRAINT "conversation_splits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_splits" ADD CONSTRAINT "conversation_splits_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_splits" ADD CONSTRAINT "conversation_splits_target_conversation_id_conversations_id_fk" FOREIGN KEY ("target_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_splits" ADD CONSTRAINT "conversation_splits_split_message_id_messages_id_fk" FOREIGN KEY ("split_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_splits" ADD CONSTRAINT "conversation_splits_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_team_id_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_merged_into_id_conversations_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_merged_into_id_identities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_conversion_logs" ADD CONSTRAINT "identity_conversion_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_conversion_logs" ADD CONSTRAINT "identity_conversion_logs_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_conversion_logs" ADD CONSTRAINT "identity_conversion_logs_converted_by_user_id_users_id_fk" FOREIGN KEY ("converted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_merge_logs" ADD CONSTRAINT "identity_merge_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_merge_logs" ADD CONSTRAINT "identity_merge_logs_identity_a_id_identities_id_fk" FOREIGN KEY ("identity_a_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_merge_logs" ADD CONSTRAINT "identity_merge_logs_identity_b_id_identities_id_fk" FOREIGN KEY ("identity_b_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_merge_logs" ADD CONSTRAINT "identity_merge_logs_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_transfers" ADD CONSTRAINT "live_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_transfers" ADD CONSTRAINT "live_transfers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_transfers" ADD CONSTRAINT "live_transfers_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_transfers" ADD CONSTRAINT "live_transfers_attempted_user_id_users_id_fk" FOREIGN KEY ("attempted_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batch_recipients" ADD CONSTRAINT "outbound_batch_recipients_batch_id_outbound_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outbound_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batch_recipients" ADD CONSTRAINT "outbound_batch_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batch_recipients" ADD CONSTRAINT "outbound_batch_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batches" ADD CONSTRAINT "outbound_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_assignees_user_idx" ON "conversation_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_identity_unique" ON "conversation_participants" USING btree ("conversation_id","identity_id") WHERE "conversation_participants"."identity_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_user_unique" ON "conversation_participants" USING btree ("conversation_id","user_id") WHERE "conversation_participants"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "conversation_participants_conversation_idx" ON "conversation_participants" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_personal_tags_user_idx" ON "conversation_personal_tags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_read_states_user_idx" ON "conversation_read_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_splits_source_idx" ON "conversation_splits" USING btree ("source_conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_splits_target_idx" ON "conversation_splits" USING btree ("target_conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_tags_tag_idx" ON "conversation_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_last_message_idx" ON "conversations" USING btree ("tenant_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_identity_idx" ON "conversations" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "conversations_response_due_idx" ON "conversations" USING btree ("response_due_at") WHERE "conversations"."response_due_at" is not null;--> statement-breakpoint
CREATE INDEX "conversations_tenant_identity_open_idx" ON "conversations" USING btree ("tenant_id","identity_id") WHERE "conversations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "document_chunks_tenant_idx" ON "document_chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "identities_tenant_idx" ON "identities" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_tenant_phone_unique" ON "identities" USING btree ("tenant_id","phone") WHERE "identities"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_tenant_email_unique" ON "identities" USING btree ("tenant_id","email") WHERE "identities"."email" is not null;--> statement-breakpoint
CREATE INDEX "identities_merged_into_idx" ON "identities" USING btree ("merged_into_id") WHERE "identities"."merged_into_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_tenant_reside_resident_unique" ON "identities" USING btree ("tenant_id","reside_resident_id") WHERE "identities"."reside_resident_id" is not null;--> statement-breakpoint
CREATE INDEX "identity_conversion_logs_tenant_idx" ON "identity_conversion_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "identity_conversion_logs_identity_idx" ON "identity_conversion_logs" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "identity_merge_logs_tenant_idx" ON "identity_merge_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "call_transfers_tenant_idx" ON "live_transfers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "call_transfers_conversation_idx" ON "live_transfers" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_tenant_idx" ON "messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_provider_message_id_idx" ON "messages" USING btree ("provider_message_id") WHERE "messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_idempotency_key_unique" ON "messages" USING btree ("tenant_id","idempotency_key") WHERE "messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "outbound_batch_recipients_pending_idx" ON "outbound_batch_recipients" USING btree ("created_at") WHERE "outbound_batch_recipients"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbound_batch_recipients_batch_idx" ON "outbound_batch_recipients" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "outbound_batch_recipients_claimed_idx" ON "outbound_batch_recipients" USING btree ("claimed_at") WHERE "outbound_batch_recipients"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "tags_tenant_idx" ON "tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "team_memberships_team_idx" ON "team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "teams_tenant_idx" ON "teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenants_twilio_number_idx" ON "tenants" USING btree ("twilio_number");--> statement-breakpoint
CREATE INDEX "tenants_inbound_email_idx" ON "tenants" USING btree ("inbound_email_address");--> statement-breakpoint
CREATE INDEX "tenants_reside_client_uid_idx" ON "tenants" USING btree ("reside_client_uid");--> statement-breakpoint
CREATE INDEX "user_tenant_memberships_tenant_idx" ON "user_tenant_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");