CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."analytics_event_type" ADD VALUE 'offer_sent';--> statement-breakpoint
ALTER TYPE "public"."analytics_event_type" ADD VALUE 'offer_accepted';--> statement-breakpoint
CREATE TABLE "swap_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"offered_section_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "swap_offers" ADD CONSTRAINT "swap_offers_request_id_swap_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."swap_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_offers" ADD CONSTRAINT "swap_offers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_offers" ADD CONSTRAINT "swap_offers_offered_section_id_sections_id_fk" FOREIGN KEY ("offered_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swap_offers_one_pending" ON "swap_offers" USING btree ("request_id","from_user_id") WHERE "swap_offers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "swap_offers_from_user_idx" ON "swap_offers" USING btree ("from_user_id");