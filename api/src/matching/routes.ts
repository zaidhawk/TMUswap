import { Router } from "express";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db/index.js";
import { courses, matches, matchMembers, sections, swapRequests, users } from "../db/schema.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { parseBody } from "../validate.js";
import { endMatch, tryMatchRequest } from "./engine.js";

const gives = alias(sections, "gives");
const gets = alias(sections, "gets");

const answerBody = z.object({
  accept: z.boolean({ error: "Send accept: true or false" }),
});

// Loads a match as `userId` should see it: course, status, and who gives what to whom.
// Other members appear by display name only, never by email.
async function loadMatchView(matchId: string, userId: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { status: 404 as const };

  const rows = await db
    .select({
      userId: swapRequests.userId,
      displayName: users.displayName,
      gives: gives.label,
      gets: gets.label,
      acceptedAt: matchMembers.acceptedAt,
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
      members: ordered.map((r) => ({
        displayName: r.displayName,
        gives: r.gives,
        gets: r.gets,
        accepted: r.acceptedAt !== null,
        isMe: r.userId === userId,
      })),
    },
  };
}

const errors = {
  403: { error: "You're not part of this match" },
  404: { error: "Match not found" },
};

export const matchesRouter = Router();
matchesRouter.use(requireAuth);

matchesRouter.get("/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(errors[404]);
    return;
  }

  const view = await loadMatchView(id.data, currentUser(res).id);
  if (view.status !== 200) {
    res.status(view.status).json(errors[view.status]);
    return;
  }
  res.json({ match: view.match });
});

// Accept or decline a proposed match. When everyone accepts, the match becomes "accepted".
// A decline ends it: the decliner's request is cancelled and everyone else's reopens.
matchesRouter.post("/:id/accept", async (req, res) => {
  const user = currentUser(res);
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(errors[404]);
    return;
  }
  const body = parseBody(answerBody, req.body, res);
  if (!body) return;

  const outcome = await db.transaction(async (tx) => {
    // Lock the match so two members answering at the same moment are handled one at a time.
    const [match] = await tx.select().from(matches).where(eq(matches.id, id.data)).for("update");
    if (!match) return { status: 404 as const };

    const members = await tx
      .select({
        requestId: matchMembers.requestId,
        userId: swapRequests.userId,
        acceptedAt: matchMembers.acceptedAt,
      })
      .from(matchMembers)
      .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
      .where(eq(matchMembers.matchId, match.id));
    const mine = members.find((m) => m.userId === user.id);
    if (!mine) return { status: 403 as const };

    if (match.status !== "proposed" || match.expiresAt <= new Date()) {
      return { status: 409 as const };
    }

    if (!body.accept) {
      const reopened = await endMatch(tx, match.id, (m) =>
        m.requestId === mine.requestId ? "cancelled" : "open",
      );
      return { status: 200 as const, reopened };
    }

    if (!mine.acceptedAt) {
      await tx
        .update(matchMembers)
        .set({ acceptedAt: new Date() })
        .where(eq(matchMembers.requestId, mine.requestId));
    }
    const everyoneAccepted = members.every((m) => m.acceptedAt || m.requestId === mine.requestId);
    if (everyoneAccepted) {
      await tx.update(matches).set({ status: "accepted" }).where(eq(matches.id, match.id));
    }
    return { status: 200 as const, reopened: [] };
  });

  if (outcome.status === 409) {
    res.status(409).json({ error: "This match is no longer waiting for answers" });
    return;
  }
  if (outcome.status !== 200) {
    res.status(outcome.status).json(errors[outcome.status]);
    return;
  }

  // The others in a declined match go straight back into the pool.
  for (const requestId of outcome.reopened) {
    await tryMatchRequest(requestId);
  }

  const view = await loadMatchView(id.data, user.id);
  res.json({ match: view.status === 200 ? view.match : null });
});
