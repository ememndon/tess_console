CREATE TYPE "public"."event_type" AS ENUM('pageview', 'event', 'error', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'seen', 'actioned');--> statement-breakpoint
CREATE TABLE "daily_breakdowns" (
	"site" text NOT NULL,
	"day" date NOT NULL,
	"dimension" text NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_breakdowns_site_day_dimension_key_pk" PRIMARY KEY("site","day","dimension","key")
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"site" text NOT NULL,
	"day" date NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"not_found" integer DEFAULT 0 NOT NULL,
	"avg_load_ms" integer,
	CONSTRAINT "daily_stats_site_day_pk" PRIMARY KEY("site","day")
);
--> statement-breakpoint
CREATE TABLE "embed_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"host" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"type" "event_type" DEFAULT 'pageview' NOT NULL,
	"name" text,
	"path" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"country" text,
	"device" text,
	"browser" text,
	"os" text,
	"load_ms" integer,
	"visitor_id" text,
	"props" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"path" text,
	"rating" text,
	"message" text,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "embed_site_host_idx" ON "embed_registry" USING btree ("site","host");--> statement-breakpoint
CREATE INDEX "events_site_created_idx" ON "events" USING btree ("site","created_at");--> statement-breakpoint
CREATE INDEX "events_site_type_created_idx" ON "events" USING btree ("site","type","created_at");--> statement-breakpoint
CREATE INDEX "feedback_site_created_idx" ON "feedback" USING btree ("site","created_at");