ALTER TABLE "matches" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
-- Matches that already ended get today as their closing time, so their chats are kept 30 more days.
UPDATE "matches" SET "closed_at" = now() WHERE "status" IN ('completed', 'failed', 'expired') AND "closed_at" IS NULL;
