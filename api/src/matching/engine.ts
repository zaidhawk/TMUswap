import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { courses, matches, matchMembers, sections, swapRequests, swapWants, users } from "../db/schema.js";
import { sendMatchFound } from "../email.js";
import { findTriangle, type Cycle, type OpenRequest } from "./cycles.js";

export const MATCH_TTL_MS = 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A direct swap: someone else's open request has a section we want and wants ours.
// Oldest first, so early posters get matched first.
async function findPair(requestId: string): Promise<Cycle | null> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT b.id
    FROM swap_requests a
    JOIN swap_wants wa ON wa.request_id = a.id
    JOIN swap_requests b ON b.have_section_id = wa.section_id
    JOIN swap_wants wb ON wb.request_id = b.id AND wb.section_id = a.have_section_id
    WHERE a.id = ${requestId} AND a.status = 'open' AND b.status = 'open' AND b.user_id <> a.user_id
    ORDER BY b.created_at
    LIMIT 1
  `);
  const partner = result.rows[0];
  return partner ? [requestId, partner.id] : null;
}

// A 3-way swap. Loads the open requests for the same course and kind (a few hundred at most)
// and searches them in memory.
async function findTriangleFor(requestId: string): Promise<Cycle | null> {
  const [start] = await db
    .select({ courseId: sections.courseId, kind: sections.kind })
    .from(swapRequests)
    .innerJoin(sections, eq(sections.id, swapRequests.haveSectionId))
    .where(and(eq(swapRequests.id, requestId), eq(swapRequests.status, "open")));
  if (!start) return null;

  const rows = await db
    .select({
      id: swapRequests.id,
      userId: swapRequests.userId,
      have: swapRequests.haveSectionId,
      createdAt: swapRequests.createdAt,
      want: swapWants.sectionId,
    })
    .from(swapRequests)
    .innerJoin(sections, eq(sections.id, swapRequests.haveSectionId))
    .innerJoin(swapWants, eq(swapWants.requestId, swapRequests.id))
    .where(
      and(
        eq(swapRequests.status, "open"),
        eq(sections.courseId, start.courseId),
        eq(sections.kind, start.kind),
      ),
    );

  const requests = new Map<string, OpenRequest>();
  for (const row of rows) {
    const request = requests.get(row.id) ?? { ...row, wants: new Set<string>() };
    request.wants.add(row.want);
    requests.set(row.id, request);
  }
  return findTriangle(requestId, [...requests.values()]);
}

// Claims every request in the cycle and creates the match, all in one transaction. Locking the
// rows (FOR UPDATE) means two matches running at once can't both claim the same request: the
// second waits, then sees it's no longer open and gives up. Returns null if anything changed.
async function reserve(cycle: Cycle): Promise<string | null> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: swapRequests.id, status: swapRequests.status, have: swapRequests.haveSectionId })
      .from(swapRequests)
      .where(inArray(swapRequests.id, cycle))
      .orderBy(asc(swapRequests.id)) // same lock order everywhere, so two transactions can't deadlock
      .for("update");
    if (locked.length !== cycle.length || locked.some((r) => r.status !== "open")) return null;

    const haveOf = new Map(locked.map((r) => [r.id, r.have]));
    const gets = cycle.map((_, i) => haveOf.get(cycle[(i + 1) % cycle.length]!)!);

    // Wants may have been edited since the search, so check every link again.
    const wants = await tx
      .select({ requestId: swapWants.requestId, sectionId: swapWants.sectionId })
      .from(swapWants)
      .where(inArray(swapWants.requestId, cycle));
    const stillValid = cycle.every((id, i) =>
      wants.some((w) => w.requestId === id && w.sectionId === gets[i]),
    );
    if (!stillValid) return null;

    await tx.update(swapRequests).set({ status: "matched" }).where(inArray(swapRequests.id, cycle));
    const [match] = await tx
      .insert(matches)
      .values({ size: cycle.length, expiresAt: new Date(Date.now() + MATCH_TTL_MS) })
      .returning({ id: matches.id });
    await tx.insert(matchMembers).values(
      cycle.map((id, i) => ({
        matchId: match!.id,
        requestId: id,
        givesSectionId: haveOf.get(id)!,
        getsSectionId: gets[i]!,
      })),
    );
    return match!.id;
  });
}

// Emails everyone in a new match. A failed email is logged, never fatal: the match still stands.
async function notifyMatch(matchId: string) {
  const members = await db
    .select({ email: users.email, courseCode: courses.code })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .innerJoin(users, eq(users.id, swapRequests.userId))
    .innerJoin(sections, eq(sections.id, matchMembers.givesSectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(eq(matchMembers.matchId, matchId));

  const url = `${config.webOrigin}/matches/${matchId}`;
  await Promise.all(
    members.map((m) =>
      sendMatchFound(m.email, m.courseCode, url).catch((err) =>
        console.error(`Failed to email ${m.email} about match ${matchId}:`, err),
      ),
    ),
  );
}

// Tries to match one open request: a pair first, then a triangle. Retries a couple of times in
// case another match grabbed one of the requests between the search and the reservation.
export async function matchRequest(requestId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cycle = (await findPair(requestId)) ?? (await findTriangleFor(requestId));
    if (!cycle) return null;
    const matchId = await reserve(cycle);
    if (matchId) {
      await notifyMatch(matchId);
      return matchId;
    }
  }
  return null;
}

// Like matchRequest, but never throws: a matching bug shouldn't fail the request that triggered
// it. The 10-minute sweep will try again.
export async function tryMatchRequest(requestId: string): Promise<string | null> {
  try {
    return await matchRequest(requestId);
  } catch (err) {
    console.error(`Matching failed for request ${requestId}:`, err);
    return null;
  }
}

type MemberOutcome = { requestId: string; userId: string; acceptedAt: Date | null };

// Ends a proposed match and decides what happens to each member's request. Returns the ids of
// requests that went back to open, so the caller can try to re-match them.
export async function endMatch(
  tx: Tx,
  matchId: string,
  nextStatus: (member: MemberOutcome) => "open" | "cancelled" | "expired",
): Promise<string[]> {
  await tx.update(matches).set({ status: "expired" }).where(eq(matches.id, matchId));
  const members = await tx
    .select({
      requestId: matchMembers.requestId,
      userId: swapRequests.userId,
      acceptedAt: matchMembers.acceptedAt,
    })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .where(eq(matchMembers.matchId, matchId));

  const reopened: string[] = [];
  for (const member of members) {
    const status = nextStatus(member);
    await tx.update(swapRequests).set({ status }).where(eq(swapRequests.id, member.requestId));
    if (status === "open") reopened.push(member.requestId);
  }
  return reopened;
}

// Expires matches that weren't fully accepted within 24 hours. Members who accepted go back
// to open; members who never answered have their requests expired.
export async function expireDueMatches(now = new Date()): Promise<string[]> {
  const due = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.status, "proposed"), lt(matches.expiresAt, now)));

  const reopened: string[] = [];
  for (const { id } of due) {
    const ids = await db.transaction(async (tx) => {
      const [match] = await tx.select().from(matches).where(eq(matches.id, id)).for("update");
      // Someone may have answered while we were looping.
      if (!match || match.status !== "proposed" || match.expiresAt >= now) return [];
      return endMatch(tx, id, (m) => (m.acceptedAt ? "open" : "expired"));
    });
    reopened.push(...ids);
  }
  return reopened;
}

// The safety net, run every 10 minutes: expire stale matches, then try every open request,
// oldest first.
export async function runSweep(now = new Date()): Promise<void> {
  await expireDueMatches(now);
  const open = await db
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(eq(swapRequests.status, "open"))
    .orderBy(asc(swapRequests.createdAt));
  for (const { id } of open) {
    await tryMatchRequest(id);
  }
}
