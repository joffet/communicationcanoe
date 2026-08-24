DROP INDEX "identities_tenant_phone_unique";--> statement-breakpoint
DROP INDEX "identities_tenant_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "identities_tenant_phone_unique" ON "identities" USING btree ("tenant_id","phone") WHERE "identities"."phone" is not null and "identities"."merged_into_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_tenant_email_unique" ON "identities" USING btree ("tenant_id","email") WHERE "identities"."email" is not null and "identities"."merged_into_id" is null;