CREATE TABLE "gsc_daily" (
	"site" text NOT NULL,
	"day" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" double precision,
	"position" double precision,
	CONSTRAINT "gsc_daily_site_day_pk" PRIMARY KEY("site","day")
);
--> statement-breakpoint
CREATE TABLE "gsc_pages" (
	"site" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" double precision,
	"position" double precision,
	CONSTRAINT "gsc_pages_site_page_pk" PRIMARY KEY("site","page")
);
--> statement-breakpoint
CREATE TABLE "gsc_queries" (
	"site" text NOT NULL,
	"query" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" double precision,
	"position" double precision,
	CONSTRAINT "gsc_queries_site_query_pk" PRIMARY KEY("site","query")
);
