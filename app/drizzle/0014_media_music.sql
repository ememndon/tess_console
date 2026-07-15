ALTER TABLE "media_jobs" ALTER COLUMN "voice" SET DEFAULT 'kokoro';--> statement-breakpoint
ALTER TABLE "media_jobs" ADD COLUMN "music" text DEFAULT 'auto' NOT NULL;