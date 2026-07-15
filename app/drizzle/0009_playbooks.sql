CREATE TYPE "public"."playbook_status" AS ENUM('active', 'draft', 'archived');--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"trigger" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "playbook_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "playbooks_category_idx" ON "playbooks" USING btree ("category");