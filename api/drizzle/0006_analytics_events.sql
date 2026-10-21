CREATE TYPE "public"."analytics_event_type" AS ENUM('signed_up', 'request_posted');--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "analytics_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Count the accounts and requests that already exist, at the time they were created.
INSERT INTO "analytics_events" ("type", "created_at") SELECT 'signed_up', "created_at" FROM "users";--> statement-breakpoint
INSERT INTO "analytics_events" ("type", "created_at") SELECT 'request_posted', "created_at" FROM "swap_requests";
