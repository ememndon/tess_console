ALTER TABLE "notifications" ADD COLUMN "delivered_at" timestamp with time zone;
--> statement-breakpoint
-- Backfill: treat all pre-existing alerts as already delivered so the new
-- notify-dispatch cron doesn't flood Telegram/email with historical bell items.
UPDATE "notifications" SET "delivered_at" = "created_at" WHERE "delivered_at" IS NULL;