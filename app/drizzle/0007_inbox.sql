CREATE TYPE "public"."dns_kind" AS ENUM('spf', 'dkim', 'dmarc', 'mx');--> statement-breakpoint
CREATE TYPE "public"."dns_status" AS ENUM('pass', 'warn', 'fail', 'missing');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pending', 'approved', 'sent', 'discarded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mail_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."outreach_msg_status" AS ENUM('draft', 'approved', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outreach_stage" AS ENUM('prospect', 'contacted', 'replied', 'negotiating', 'won', 'lost', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('active', 'unsubscribed', 'bounced');--> statement-breakpoint
CREATE TABLE "dns_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"domain" text NOT NULL,
	"kind" "dns_kind" NOT NULL,
	"status" "dns_status" DEFAULT 'missing' NOT NULL,
	"record" text,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"in_reply_to" uuid,
	"thread_key" text,
	"to_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"generated_by" text DEFAULT 'tess' NOT NULL,
	"provider" text,
	"approved_by" text,
	"sent_at" timestamp with time zone,
	"smtp_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"uid" integer NOT NULL,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"direction" "mail_direction" DEFAULT 'inbound' NOT NULL,
	"message_id" text,
	"thread_key" text NOT NULL,
	"from_addr" text,
	"from_name" text,
	"to_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"snippet" text,
	"body_text" text,
	"body_html" text,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_date" timestamp with time zone,
	"seen" boolean DEFAULT false NOT NULL,
	"answered" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"actionable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"address" text NOT NULL,
	"display_name" text NOT NULL,
	"purpose" text DEFAULT 'support' NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_secure" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"signature" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "secret_status" DEFAULT 'untested' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_error" text,
	"sync_fails" integer DEFAULT 0 NOT NULL,
	"last_uid" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "outreach_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"org" text,
	"role" text,
	"category" text DEFAULT 'partner' NOT NULL,
	"stage" "outreach_stage" DEFAULT 'prospect' NOT NULL,
	"source" text,
	"notes" text,
	"opted_out" boolean DEFAULT false NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" "outreach_msg_status" DEFAULT 'draft' NOT NULL,
	"generated_by" text DEFAULT 'tess' NOT NULL,
	"approved_by" text,
	"sent_at" timestamp with time zone,
	"smtp_message_id" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" "subscriber_status" DEFAULT 'active' NOT NULL,
	"source" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_in_reply_to_email_messages_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_contact_id_outreach_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."outreach_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dns_checks_domain_kind_idx" ON "dns_checks" USING btree ("domain","kind");--> statement-breakpoint
CREATE INDEX "email_drafts_box_status_idx" ON "email_drafts" USING btree ("mailbox_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_msg_box_folder_uid_idx" ON "email_messages" USING btree ("mailbox_id","folder","uid");--> statement-breakpoint
CREATE INDEX "email_msg_box_thread_idx" ON "email_messages" USING btree ("mailbox_id","thread_key");--> statement-breakpoint
CREATE INDEX "email_msg_box_date_idx" ON "email_messages" USING btree ("mailbox_id","internal_date");--> statement-breakpoint
CREATE INDEX "mailboxes_site_idx" ON "mailboxes" USING btree ("site");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_site_email_idx" ON "outreach_contacts" USING btree ("site","email");--> statement-breakpoint
CREATE INDEX "outreach_msgs_contact_idx" ON "outreach_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_site_email_idx" ON "subscribers" USING btree ("site","email");