import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const time = (name: string) => timestamp(name, { withTimezone: true });

export const sectionKind = pgEnum("section_kind", ["lecture", "lab", "tutorial"]);
export const requestStatus = pgEnum("request_status", [
  "open",
  "matched",
  "completed",
  "cancelled",
  "expired",
]);
export const matchStatus = pgEnum("match_status", [
  "proposed",
  "accepted",
  "counting_down",
  "completed",
  "failed",
  "expired",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    // Null until the user picks one on their first login.
    displayName: text("display_name"),
    isBanned: boolean("is_banned").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [check("users_email_tmu", sql`${t.email} LIKE '%@torontomu.ca'`)],
);

// One row per emailed 6-digit code. Only the hash is stored, never the code itself.
export const loginCodes = pgTable(
  "login_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: time("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: time("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)],
);

// The id is the random value stored in the user's session cookie.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(),
  createdAt: createdAt(),
});

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    term: text("term").notNull(),
    title: text("title").notNull(),
  },
  (t) => [unique("courses_code_term_unique").on(t.code, t.term)],
);

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    kind: sectionKind("kind").notNull(),
    label: text("label").notNull(),
  },
  (t) => [unique("sections_course_kind_label_unique").on(t.courseId, t.kind, t.label)],
);

export const swapRequests = pgTable(
  "swap_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    haveSectionId: uuid("have_section_id")
      .notNull()
      .references(() => sections.id),
    status: requestStatus("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    // You can only offer a seat you hold once at a time.
    uniqueIndex("swap_requests_one_active_per_section")
      .on(t.userId, t.haveSectionId)
      .where(sql`${t.status} IN ('open', 'matched')`),
    index("swap_requests_have_section_idx").on(t.haveSectionId, t.status),
  ],
);

// The sections a request will accept. Same course and kind as the one offered (checked in code).
export const swapWants = pgTable(
  "swap_wants",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => swapRequests.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.sectionId] }),
    index("swap_wants_section_idx").on(t.sectionId),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    size: integer("size").notNull(),
    status: matchStatus("status").notNull().default("proposed"),
    createdAt: createdAt(),
    expiresAt: time("expires_at").notNull(),
    // The member who drops their section first. Only they are briefly without a seat.
    firstRequestId: uuid("first_request_id"),
    // Set when the last member presses Start countdown: the moment everyone starts, by the server's clock.
    countdownStartsAt: time("countdown_starts_at"),
    // When the match ended (completed, failed or expired). Its chat is deleted 30 days later.
    closedAt: time("closed_at"),
  },
  (t) => [check("matches_size_2_or_3", sql`${t.size} IN (2, 3)`)],
);

export const matchMembers = pgTable(
  "match_members",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => swapRequests.id, { onDelete: "cascade" }),
    givesSectionId: uuid("gives_section_id")
      .notNull()
      .references(() => sections.id),
    getsSectionId: uuid("gets_section_id")
      .notNull()
      .references(() => sections.id),
    acceptedAt: time("accepted_at"),
    countdownPressedAt: time("countdown_pressed_at"),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.requestId] })],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("messages_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 1000`),
    index("messages_match_created_idx").on(t.matchId, t.createdAt),
  ],
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reportedUserId: uuid("reported_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
  resolvedAt: time("resolved_at"),
});

export type User = typeof users.$inferSelect;
