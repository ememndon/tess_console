CREATE TYPE "public"."post_kind" AS ENUM('text', 'banner', 'video');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'scheduled', 'ready', 'publishing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('x', 'facebook', 'instagram', 'linkedin', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."target_status" AS ENUM('queued', 'published', 'handoff', 'posted', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"site" text PRIMARY KEY NOT NULL,
	"voice" text,
	"audience" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta_url" text,
	"not_financial_advice" boolean DEFAULT false NOT NULL,
	"content_mix" jsonb DEFAULT '{"text":50,"banner":35,"video":15}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_throttle" (
	"site" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"consecutive_fails" integer DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_throttle_site_platform_pk" PRIMARY KEY("site","platform")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"site" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"handle" text,
	"credentials_enc" text,
	"meta" jsonb,
	"status" "secret_status" DEFAULT 'untested' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_site_platform_pk" PRIMARY KEY("site","platform")
);
--> statement-breakpoint
CREATE TABLE "social_config" (
	"site" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'handoff' NOT NULL,
	"per_day" integer DEFAULT 1 NOT NULL,
	"times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_config_site_platform_pk" PRIMARY KEY("site","platform")
);
--> statement-breakpoint
CREATE TABLE "social_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"type" text NOT NULL,
	"path" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"kind" "post_kind" DEFAULT 'text' NOT NULL,
	"caption" text,
	"data" jsonb,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_by" text DEFAULT 'human' NOT NULL,
	"batch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"mode" text DEFAULT 'autonomous' NOT NULL,
	"status" "target_status" DEFAULT 'queued' NOT NULL,
	"external_id" text,
	"external_url" text,
	"error" text,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_targets" ADD CONSTRAINT "social_targets_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_site_sched_idx" ON "social_posts" USING btree ("site","scheduled_at");--> statement-breakpoint
CREATE INDEX "social_targets_post_idx" ON "social_targets" USING btree ("post_id");