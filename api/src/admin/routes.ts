import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";

export const STATS_DAYS = 14;

type Totals = {
  signUps: number;
  accounts: number;
  requestsPosted: number;
  openRequests: number;
  matches: number;
  threeWayMatches: number;
  acceptedMatches: number;
  completedSwaps: number;
  failedSwaps: number;
  studentsSwapped: number;
};

type Day = {
  date: string;
  signUps: number;
  requestsPosted: number;
  matches: number;
  completedSwaps: number;
};

// Counts for the admin stats page: all-time totals, and the last 14 days by Toronto date.
// Sign-ups and requests come from analytics_events, which keeps counting after accounts are
// deleted; matches are never deleted, so they come straight from the matches table.
export async function loadStats(now = new Date()): Promise<{ totals: Totals; days: Day[] }> {
  const totals = await db.execute<Totals>(sql`
    SELECT
      (SELECT count(*) FROM analytics_events WHERE type = 'signed_up')::int AS "signUps",
      (SELECT count(*) FROM users)::int AS "accounts",
      (SELECT count(*) FROM analytics_events WHERE type = 'request_posted')::int AS "requestsPosted",
      (SELECT count(*) FROM swap_requests WHERE status = 'open')::int AS "openRequests",
      (SELECT count(*) FROM matches)::int AS "matches",
      (SELECT count(*) FROM matches WHERE size = 3)::int AS "threeWayMatches",
      -- Everyone said yes. Failed swaps got that far too: an outcome can only be reported after.
      (SELECT count(*) FROM matches
        WHERE status IN ('accepted', 'counting_down', 'completed', 'failed'))::int AS "acceptedMatches",
      (SELECT count(*) FROM matches WHERE status = 'completed')::int AS "completedSwaps",
      (SELECT count(*) FROM matches WHERE status = 'failed')::int AS "failedSwaps",
      (SELECT coalesce(sum(size), 0) FROM matches WHERE status = 'completed')::int AS "studentsSwapped"
  `);

  // One row per day, newest first, including days when nothing happened.
  const days = await db.execute<Day>(sql`
    WITH happenings AS (
      SELECT type::text AS kind, created_at AS at FROM analytics_events
      UNION ALL SELECT 'match_made', created_at FROM matches
      UNION ALL SELECT 'swap_completed', closed_at FROM matches WHERE status = 'completed'
    ),
    days AS (
      SELECT generate_series(today - ${STATS_DAYS - 1}::int, today, interval '1 day')::date AS day
      FROM (SELECT (${now.toISOString()}::timestamptz AT TIME ZONE 'America/Toronto')::date AS today) t
    )
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS "date",
      count(*) FILTER (WHERE kind = 'signed_up')::int AS "signUps",
      count(*) FILTER (WHERE kind = 'request_posted')::int AS "requestsPosted",
      count(*) FILTER (WHERE kind = 'match_made')::int AS "matches",
      count(*) FILTER (WHERE kind = 'swap_completed')::int AS "completedSwaps"
    FROM days
    LEFT JOIN happenings ON (happenings.at AT TIME ZONE 'America/Toronto')::date = days.day
    GROUP BY days.day
    ORDER BY days.day DESC
  `);

  return { totals: totals.rows[0]!, days: days.rows };
}

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/stats", async (_req, res) => {
  res.json(await loadStats());
});
