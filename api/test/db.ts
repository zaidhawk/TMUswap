import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";

// Empties every table so each test starts from a clean database.
export async function resetDb() {
  await db.execute(sql`
    TRUNCATE users, login_codes, sessions, courses, sections, swap_requests,
      swap_wants, matches, match_members, messages, reports, analytics_events
    RESTART IDENTITY CASCADE
  `);
}
