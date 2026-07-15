CREATE TYPE "public"."monitor_kind" AS ENUM('http', 'rate');--> statement-breakpoint
CREATE TYPE "public"."monitor_status" AS ENUM('up', 'down', 'unknown', 'unconfigured');--> statement-breakpoint
CREATE TABLE "monitor_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"monitor_key" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"code" integer
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"kind" "monitor_kind" DEFAULT 'http' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" "monitor_status" DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_latency_ms" integer,
	"last_code" integer,
	"down_since" timestamp with time zone,
	"last_error" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE INDEX "monitor_checks_key_time_idx" ON "monitor_checks" USING btree ("monitor_key","checked_at");