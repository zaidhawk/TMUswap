import { Router, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db/index.js";
import { courses, matches, matchMembers, sections, swapRequests, users } from "../db/schema.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { parseBody } from "../validate.js";
import { loadMessages } from "../chat/service.js";
import { emitToUsers } from "../realtime/io.js";
import { endMatch, tryMatchRequest } from "./engine.js";
import { COUNTDOWN_LEAD_MS, clock, countdownBlockedReason, swapSteps } from "./countdown.js";

const gives = alias(sections, "gives");
const gets = alias(sections, "gets");

const answerBody = z.object({ accept: z.boolean({ error: "Send accept: true or false" }) });
const firstMoverBody = z.object({ memberId: z.uuid({ error: "Pick who goes first" }) });
const pressBody = z.object({ press: z.boolean({ error: "Send press: true or false" }) });
const outcomeBody = z.object({
  outcome: z.enum(["completed", "failed"], { error: "Send outcome: completed or failed" }),
});

// Loads a match as `userId` should see it: course, status, who gives what to whom, and the
// countdown. Other members appear by display name only, never by email.
async function loadMatchView(matchId: string, userId: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { status: 404 as const };

  const rows = await db
    .select({
      memberId: matchMembers.requestId,
      userId: swapRequests.userId,
      displayName: users.displayName,
      gives: gives.label,
      gets: gets.label,
      acceptedAt: matchMembers.acceptedAt,
      countdownPressedAt: matchMembers.countdownPressedAt,
      kind: gives.kind,
      courseCode: courses.code,
      courseTitle: courses.title,
    })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .innerJoin(users, eq(users.id, swapRequests.userId))
    .innerJoin(gives, eq(gives.id, matchMembers.givesSectionId))
    .innerJoin(gets, eq(gets.id, matchMembers.getsSectionId))
    .innerJoin(courses, eq(courses.id, gives.courseId))
    .where(eq(matchMembers.matchId, matchId));

  if (!rows.some((r) => r.userId === userId)) return { status: 403 as const };

  // Put the members in swap order starting with you: each person gives the section the
  // previous person gets.
  const ordered = [rows.find((r) => r.userId === userId)!];
  while (ordered.length < rows.length) {
    const last = ordered[ordered.length - 1]!;
    ordered.push(rows.find((r) => r.gives === last.gets)!);
  }
  const members = ordered.map((r) => ({
    memberId: r.memberId,
    displayName: r.displayName,
    gives: r.gives,
    gets: r.gets,
    accepted: r.acceptedAt !== null,
    pressedStart: r.countdownPressedAt !== null,
    goesFirst: r.memberId === match.firstRequestId,
    isMe: r.userId === userId,
  }));

  const now = new Date();
  const first = rows[0]!;
  return {
    status: 200 as const,
    match: {
      id: match.id,
      size: match.size,
      status: match.status,
      expiresAt: match.expiresAt,
      courseCode: first.courseCode,
      courseTitle: first.courseTitle,
      kind: first.kind,
      members,
      steps: match.firstRequestId ? swapSteps(members, match.firstRequestId) : [],
      countdownStartsAt: match.countdownStartsAt,
      countdownBlockedReason: countdownBlockedReason(clock.now()),
      // Lets each browser work out how far its clock is from ours, so everyone sees the same countdown.
      serverTime: now,
    },
  };
}

// The user ids of everyone in a match, for sending them live updates.
async function memberUserIds(matchId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: swapRequests.userId })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .where(eq(matchMembers.matchId, matchId));
  return rows.map((r) => r.userId);
}

async function announceUpdate(matchId: string) {
  emitToUsers(await memberUserIds(matchId), "match:updated", { matchId });
}

const errors = {
  403: { error: "You're not part of this match" },
  404: { error: "Match not found" },
};

function parseMatchId(raw: string | undefined, res: Response): string | undefined {
  const id = z.uuid().safeParse(raw);
  if (!id.success) {
    res.status(404).json(errors[404]);
    return undefined;
  }
  return id.data;
}

type Member = { requestId: string; userId: string; acceptedAt: Date | null; countdownPressedAt: Date | null };

// Runs `change` inside a transaction with the match row locked, after checking that the user is
// a member. `change` returns an error to send, or nothing on success.
async function changeMatch(
  matchId: string,
  userId: string,
  change: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    match: typeof matches.$inferSelect,
    members: Member[],
    mine: Member,
  ) => Promise<{ status: number; error: string } | { reopened?: string[] } | void>,
) {
  return db.transaction(async (tx) => {
    // Lock the match so members acting at the same moment are handled one at a time.
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (!match) return { status: 404, ...errors[404] };

    const members = await tx
      .select({
        requestId: matchMembers.requestId,
        userId: swapRequests.userId,
        acceptedAt: matchMembers.acceptedAt,
        countdownPressedAt: matchMembers.countdownPressedAt,
      })
      .from(matchMembers)
      .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
      .where(eq(matchMembers.matchId, match.id));
    const mine = members.find((m) => m.userId === userId);
    if (!mine) return { status: 403, ...errors[403] };

    return (await change(tx, match, members, mine)) ?? {};
  });
}

// Sends the result of changeMatch: the error, or the updated match after telling everyone.
async function respond(
  res: Response,
  matchId: string,
  userId: string,
  result: { status?: number; error?: string; reopened?: string[] },
) {
  if (result.error) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  await announceUpdate(matchId);
  // The others in a declined match go straight back into the pool.
  for (const requestId of result.reopened ?? []) {
    await tryMatchRequest(requestId);
  }
  const view = await loadMatchView(matchId, userId);
  res.json({ match: view.status === 200 ? view.match : null });
}

export const matchesRouter = Router();
matchesRouter.use(requireAuth);

matchesRouter.get("/:id", async (req, res) => {
  const id = parseMatchId(req.params.id, res);
  if (!id) return;

  const view = await loadMatchView(id, currentUser(res).id);
  if (view.status !== 200) {
    res.status(view.status).json(errors[view.status]);
    return;
  }
  res.json({ match: view.match });
});

// Chat history, 50 messages at a time. ?before=<message id> loads older ones.
matchesRouter.get("/:id/messages", async (req, res) => {
  const id = parseMatchId(req.params.id, res);
  if (!id) return;

  const view = await loadMatchView(id, currentUser(res).id);
  if (view.status !== 200) {
    res.status(view.status).json(errors[view.status]);
    return;
  }
  const before = z.uuid().safeParse(req.query.before);
  res.json({ messages: await loadMessages(id, before.success ? before.data : undefined) });
});

// Accept or decline a proposed match. When everyone accepts, the match becomes "accepted".
// A decline ends it: the decliner's request is cancelled and everyone else's reopens.
matchesRouter.post("/:id/accept", async (req, res) => {
  const user = currentUser(res);
  const id = parseMatchId(req.params.id, res);
  if (!id) return;
  const body = parseBody(answerBody, req.body, res);
  if (!body) return;

  const result = await changeMatch(id, user.id, async (tx, match, members, mine) => {
    if (match.status !== "proposed" || match.expiresAt <= new Date()) {
      return { status: 409, error: "This match is no longer waiting for answers" };
    }
    if (!body.accept) {
      const reopened = await endMatch(tx, match.id, (m) =>
        m.requestId === mine.requestId ? "cancelled" : "open",
      );
      return { reopened };
    }
    if (!mine.acceptedAt) {
      await tx
        .update(matchMembers)
        .set({ acceptedAt: new Date() })
        .where(eq(matchMembers.requestId, mine.requestId));
    }
    if (members.every((m) => m.acceptedAt || m.requestId === mine.requestId)) {
      await tx.update(matches).set({ status: "accepted" }).where(eq(matches.id, match.id));
    }
  });
  await respond(res, id, user.id, result);
});

// Choose who drops their section first. Changing the plan clears everyone's Start presses.
matchesRouter.post("/:id/first-mover", async (req, res) => {
  const user = currentUser(res);
  const id = parseMatchId(req.params.id, res);
  if (!id) return;
  const body = parseBody(firstMoverBody, req.body, res);
  if (!body) return;

  const result = await changeMatch(id, user.id, async (tx, match, members) => {
    if (match.status !== "accepted") {
      return { status: 409, error: "You can only change who goes first before the countdown starts" };
    }
    if (!members.some((m) => m.requestId === body.memberId)) {
      return { status: 400, error: "That person isn't in this match" };
    }
    await tx.update(matches).set({ firstRequestId: body.memberId }).where(eq(matches.id, match.id));
    await tx
      .update(matchMembers)
      .set({ countdownPressedAt: null })
      .where(eq(matchMembers.matchId, match.id));
  });
  await respond(res, id, user.id, result);
});

// Press (or un-press) Start countdown. When the last member presses, the countdown starts
// 10 seconds from now, by the server's clock, for everyone at once.
matchesRouter.post("/:id/start-countdown", async (req, res) => {
  const user = currentUser(res);
  const id = parseMatchId(req.params.id, res);
  if (!id) return;
  const body = parseBody(pressBody, req.body, res);
  if (!body) return;

  const result = await changeMatch(id, user.id, async (tx, match, members, mine) => {
    if (match.status !== "accepted") {
      return {
        status: 409,
        error:
          match.status === "counting_down"
            ? "The countdown has already started"
            : "Everyone has to accept the swap before the countdown",
      };
    }
    const blocked = countdownBlockedReason(clock.now());
    if (body.press && blocked) return { status: 409, error: blocked };

    await tx
      .update(matchMembers)
      .set({ countdownPressedAt: body.press ? new Date() : null })
      .where(eq(matchMembers.requestId, mine.requestId));

    const everyonePressed =
      body.press && members.every((m) => m.countdownPressedAt || m.requestId === mine.requestId);
    if (everyonePressed) {
      await tx
        .update(matches)
        .set({ status: "counting_down", countdownStartsAt: new Date(Date.now() + COUNTDOWN_LEAD_MS) })
        .where(eq(matches.id, match.id));
    }
  });
  await respond(res, id, user.id, result);
});

// Report how the swap went. Completed closes everyone's requests; failed cancels them, so
// people can post again from wherever their seats ended up.
matchesRouter.post("/:id/outcome", async (req, res) => {
  const user = currentUser(res);
  const id = parseMatchId(req.params.id, res);
  if (!id) return;
  const body = parseBody(outcomeBody, req.body, res);
  if (!body) return;

  const result = await changeMatch(id, user.id, async (tx, match, members) => {
    if (match.status !== "accepted" && match.status !== "counting_down") {
      return { status: 409, error: "This swap has already been closed" };
    }
    await tx.update(matches).set({ status: body.outcome }).where(eq(matches.id, match.id));
    await tx
      .update(swapRequests)
      .set({ status: body.outcome === "completed" ? "completed" : "cancelled" })
      .where(
        inArray(
          swapRequests.id,
          members.map((m) => m.requestId),
        ),
      );
  });
  await respond(res, id, user.id, result);
});
