import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";

// Empties every table so each test starts from a clean database.
export async function resetDb() {
  await db.execute(sql`
    TRUNCATE users, login_codes, sessions, courses, sections, swap_requests,
      swap_wants, swap_offers, matches, match_members, messages, reports, feedback, analytics_events
    RESTART IDENTITY CASCADE
  `);
}

// Waits until `n` database sessions are stuck waiting for a lock. Race tests hold a row from
// another connection, start two actions, and wait here so both are queued at the same point.
export async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 250; i++) {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
    );
    if (rows[0]!.n >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${n} sessions waiting on a lock`);
}
