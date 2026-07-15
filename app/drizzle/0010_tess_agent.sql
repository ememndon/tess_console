CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tess_role" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"module" text DEFAULT 'agent' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"payload" jsonb,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_via" text DEFAULT 'system' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"task_type" text DEFAULT 'chat' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tess_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "tess_role" NOT NULL,
	"channel" text DEFAULT 'console' NOT NULL,
	"author" text,
	"content" text,
	"tool_name" text,
	"tool_input" jsonb,
	"tool_result" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cost_ledger_day_idx" ON "cost_ledger" USING btree ("day");--> statement-breakpoint
CREATE INDEX "tess_messages_created_idx" ON "tess_messages" USING btree ("created_at");