CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"recipe_id" text NOT NULL,
	"feature" text NOT NULL,
	"url" text NOT NULL,
	"scenario" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"formats" jsonb DEFAULT '["9:16","1:1","16:9"]'::jsonb NOT NULL,
	"voice" text DEFAULT 'piper' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"post_id" uuid,
	"result" text,
	"requested_by" text DEFAULT 'tess' NOT NULL,
	"created_by" text DEFAULT 'tess' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "media_jobs_status_idx" ON "media_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_jobs_created_idx" ON "media_jobs" USING btree ("created_at");