CREATE TYPE "public"."directory_status" AS ENUM('todo', 'submitted', 'listed', 'rejected', 'na');--> statement-breakpoint
CREATE TABLE "competitor_pages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"competitor" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"url" text NOT NULL,
	"path" text NOT NULL,
	"lastmod" timestamp with time zone,
	"title" text,
	"indexed" boolean,
	"gsc_clicks" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"site" text NOT NULL,
	"status" "directory_status" DEFAULT 'todo' NOT NULL,
	"link" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_pages_uniq" ON "competitor_pages" USING btree ("site","competitor","url");--> statement-breakpoint
CREATE INDEX "competitor_pages_site_disc_idx" ON "competitor_pages" USING btree ("site","discovered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_uniq" ON "content_pages" USING btree ("site","url");--> statement-breakpoint
CREATE INDEX "content_pages_site_idx" ON "content_pages" USING btree ("site");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_listings_uniq" ON "directory_listings" USING btree ("site","name");