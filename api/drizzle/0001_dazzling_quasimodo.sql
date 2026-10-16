CREATE TYPE "public"."match_status" AS ENUM('proposed', 'accepted', 'counting_down', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('open', 'matched', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."section_kind" AS ENUM('lecture', 'lab', 'tutorial');--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"term" text NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "courses_code_term_unique" UNIQUE("code","term")
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_members" (
	"match_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"gives_section_id" uuid NOT NULL,
	"gets_section_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"countdown_pressed_at" timestamp with time zone,
	CONSTRAINT "match_members_match_id_request_id_pk" PRIMARY KEY("match_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"size" integer NOT NULL,
	"status" "match_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "matches_size_2_or_3" CHECK ("matches"."size" IN (2, 3))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_user_id" uuid NOT NULL,
	"match_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" "section_kind" NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "sections_course_kind_label_unique" UNIQUE("course_id","kind","label")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"have_section_id" uuid NOT NULL,
	"status" "request_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_wants" (
	"request_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	CONSTRAINT "swap_wants_request_id_section_id_pk" PRIMARY KEY("request_id","section_id")
);
--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_request_id_swap_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."swap_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_gives_section_id_sections_id_fk" FOREIGN KEY ("gives_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_members" ADD CONSTRAINT "match_members_gets_section_id_sections_id_fk" FOREIGN KEY ("gets_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_have_section_id_sections_id_fk" FOREIGN KEY ("have_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_wants" ADD CONSTRAINT "swap_wants_request_id_swap_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."swap_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_wants" ADD CONSTRAINT "swap_wants_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "messages_match_created_idx" ON "messages" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "swap_requests_one_active_per_section" ON "swap_requests" USING btree ("user_id","have_section_id") WHERE "swap_requests"."status" IN ('open', 'matched');--> statement-breakpoint
CREATE INDEX "swap_requests_have_section_idx" ON "swap_requests" USING btree ("have_section_id","status");--> statement-breakpoint
CREATE INDEX "swap_wants_section_idx" ON "swap_wants" USING btree ("section_id");