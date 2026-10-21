ALTER TABLE "matches" ADD COLUMN "first_request_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "countdown_starts_at" timestamp with time zone;