import { Router, type Response } from "express";
import { and, asc, count, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
  analyticsEvents,
  courses,
  matches,
  matchMembers,
  sections,
  swapOffers,
  swapRequests,
  swapWants,
  users,
} from "../db/schema.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { parseBody } from "../validate.js";
import { isUniqueViolation } from "../db/errors.js";
import { likeEscape } from "../courses/routes.js";
import { sectionLabel, upsertSections } from "../requests/routes.js";
import { MATCH_TTL_MS } from "../matching/engine.js";
import { emitToUsers } from "../realtime/io.js";
import { sendOfferAccepted, sendOfferReceived } from "../email.js";

export const BOARD_LIMIT = 100;
export const MAX_OFFERS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// The section an offer gives, and the section the request on the Board has.
const offered = alias(sections, "offered");
const posted = alias(sections, "posted");

const offerBody = z.object({
  have: sectionLabel,
  noWaitlist: z.literal(true, { error: "Confirm your section has no wait list" }),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Failure = { status: number; error: string };

function send(res: Response, failure: Failure) {
  res.status(failure.status).json({ error: failure.error });
}

const notFound = { status: 404, error: "Offer not found" };

// ---------------------------------------------------------------------------------------------
// The Board: everyone's open requests, so students can browse a course and offer a swap even
// when their sections don't line up exactly. Posters are shown by display name, never by email.
// ---------------------------------------------------------------------------------------------

export const boardRouter = Router();
boardRouter.use(requireAuth);

// GET /board?q=cps706 — open requests, newest first, optionally filtered by course code or title.
boardRouter.get("/", async (req, res) => {
  const me = currentUser(res);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const compactQ = likeEscape(q.replace(/\s+/g, ""));

  const rows = await db
    .select({
      id: swapRequests.id,
      userId: swapRequests.userId,
      postedBy: users.displayName,
      createdAt: swapRequests.createdAt,
      courseCode: courses.code,
      courseTitle: courses.title,
      kind: sections.kind,
      have: sections.label,
    })
    .from(swapRequests)
    .innerJoin(users, eq(users.id, swapRequests.userId))
    .innerJoin(sections, eq(sections.id, swapRequests.haveSectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(
      and(
        eq(swapRequests.status, "open"),
        eq(users.isBanned, false),
        eq(courses.term, config.currentTerm),
        q
          ? or(
              sql`replace(${courses.code}, ' ', '') ILIKE ${`%${compactQ}%`}`,
              ilike(courses.title, `%${likeEscape(q)}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(swapRequests.createdAt))
    .limit(BOARD_LIMIT);
  if (rows.length === 0) {
    res.json({ requests: [] });
    return;
  }

  const ids = rows.map((r) => r.id);
  const wants = await db
    .select({ requestId: swapWants.requestId, label: sections.label })
    .from(swapWants)
    .innerJoin(sections, eq(sections.id, swapWants.sectionId))
    .where(inArray(swapWants.requestId, ids))
    .orderBy(asc(sections.label));
  // Whether I've already offered on each one (and whether they said no).
  const mine = await db
    .select({ requestId: swapOffers.requestId, status: swapOffers.status })
    .from(swapOffers)
    .where(
      and(
        eq(swapOffers.fromUserId, me.id),
        inArray(swapOffers.requestId, ids),
        inArray(swapOffers.status, ["pending", "declined"]),
      ),
    );

  res.json({
    requests: rows.map(({ userId, ...row }) => ({
      ...row,
      wants: wants.filter((w) => w.requestId === row.id).map((w) => w.label),
      isMine: userId === me.id,
      myOffer: mine.find((o) => o.requestId === row.id && o.status === "pending")
        ? "pending"
        : mine.some((o) => o.requestId === row.id)
          ? "declined"
          : null,
    })),
  });
});

// POST /board/:id/offers — "I'll give you my section for yours."
boardRouter.post("/:id/offers", async (req, res) => {
  const me = currentUser(res);
  if (!me.displayName) {
    res.status(403).json({ error: "Pick a display name first" });
    return;
  }
  const id = z.uuid().safeParse(req.params.id);
  const body = parseBody(offerBody, req.body, res);
  if (!body) return;

  const [posting] = id.success
    ? await db
        .select({
          id: swapRequests.id,
          userId: swapRequests.userId,
          status: swapRequests.status,
          courseId: sections.courseId,
          kind: sections.kind,
          have: sections.label,
          courseCode: courses.code,
          posterEmail: users.email,
        })
        .from(swapRequests)
        .innerJoin(users, eq(users.id, swapRequests.userId))
        .innerJoin(sections, eq(sections.id, swapRequests.haveSectionId))
        .innerJoin(courses, eq(courses.id, sections.courseId))
        .where(eq(swapRequests.id, id.data))
    : [];
  if (!posting) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (posting.userId === me.id) {
    res.status(400).json({ error: "That's your own request" });
    return;
  }
  if (posting.status !== "open") {
    res.status(409).json({ error: "This request isn't open anymore" });
    return;
  }
  if (body.have === posting.have) {
    res.status(400).json({ error: `They already have section ${posting.have}` });
    return;
  }

  const earlier = await db
    .select({ status: swapOffers.status })
    .from(swapOffers)
    .where(and(eq(swapOffers.requestId, posting.id), eq(swapOffers.fromUserId, me.id)));
  if (earlier.some((o) => o.status === "pending")) {
    res.status(409).json({ error: "You've already sent an offer for this request" });
    return;
  }
  if (earlier.some((o) => o.status === "declined")) {
    res.status(409).json({ error: "They declined your offer for this request" });
    return;
  }

  const [today] = await db
    .select({ n: count() })
    .from(swapOffers)
    .where(and(eq(swapOffers.fromUserId, me.id), gt(swapOffers.createdAt, new Date(Date.now() - DAY_MS))));
  if ((today?.n ?? 0) >= MAX_OFFERS_PER_DAY) {
    res.status(429).json({ error: `You've sent ${MAX_OFFERS_PER_DAY} offers today. Try again tomorrow.` });
    return;
  }

  let offerId: string;
  try {
    offerId = await db.transaction(async (tx) => {
      const ids = await upsertSections(tx, posting.courseId, posting.kind, [body.have]);
      const [created] = await tx
        .insert(swapOffers)
        .values({ requestId: posting.id, fromUserId: me.id, offeredSectionId: ids.get(body.have)! })
        .returning({ id: swapOffers.id });
      await tx.insert(analyticsEvents).values({ type: "offer_sent" });
      return created!.id;
    });
  } catch (err) {
    // Two offers sent at the same moment: the second hits the one-pending-offer rule.
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "You've already sent an offer for this request" });
      return;
    }
    throw err;
  }

  emitToUsers([posting.userId], "offer:new", { offerId });
  await sendOfferReceived(posting.posterEmail, posting.courseCode, config.webOrigin).catch((err) =>
    console.error(`Failed to email offer ${offerId}:`, err),
  );
  res.status(201).json({ offer: { id: offerId, status: "pending" } });
});

// ---------------------------------------------------------------------------------------------
// Offers: answering the ones you received, and keeping track of the ones you sent.
// ---------------------------------------------------------------------------------------------

export const offersRouter = Router();
offersRouter.use(requireAuth);

// GET /offers — offers waiting for your answer, and the offers you've sent.
offersRouter.get("/", async (_req, res) => {
  const me = currentUser(res);
  const offerer = alias(users, "offerer");

  const received = await db
    .select({
      id: swapOffers.id,
      requestId: swapOffers.requestId,
      courseCode: courses.code,
      kind: posted.kind,
      yourSection: posted.label,
      theirSection: offered.label,
      createdAt: swapOffers.createdAt,
    })
    .from(swapOffers)
    .innerJoin(swapRequests, eq(swapRequests.id, swapOffers.requestId))
    .innerJoin(offerer, eq(offerer.id, swapOffers.fromUserId))
    .innerJoin(posted, eq(posted.id, swapRequests.haveSectionId))
    .innerJoin(offered, eq(offered.id, swapOffers.offeredSectionId))
    .innerJoin(courses, eq(courses.id, posted.courseId))
    .where(
      and(
        eq(swapRequests.userId, me.id),
        eq(swapRequests.status, "open"),
        eq(swapOffers.status, "pending"),
        eq(offerer.isBanned, false),
      ),
    )
    .orderBy(asc(swapOffers.createdAt));

  const sent = await db
    .select({
      id: swapOffers.id,
      status: swapOffers.status,
      courseCode: courses.code,
      kind: posted.kind,
      yourSection: offered.label,
      theirSection: posted.label,
      requestOpen: sql<boolean>`${swapRequests.status} = 'open'`,
      createdAt: swapOffers.createdAt,
    })
    .from(swapOffers)
    .innerJoin(swapRequests, eq(swapRequests.id, swapOffers.requestId))
    .innerJoin(posted, eq(posted.id, swapRequests.haveSectionId))
    .innerJoin(offered, eq(offered.id, swapOffers.offeredSectionId))
    .innerJoin(courses, eq(courses.id, posted.courseId))
    .where(eq(swapOffers.fromUserId, me.id))
    .orderBy(desc(swapOffers.createdAt))
    .limit(20);

  res.json({ received, sent });
});

// Locks the offer and checks it's still waiting. `role` says who may act on it: the poster
// answers, the sender withdraws. Anyone else gets a 404, as if it didn't exist.
async function lockPendingOffer(tx: Tx, rawId: string | undefined, userId: string, role: "poster" | "sender") {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return notFound;
  const [offer] = await tx
    .select({
      id: swapOffers.id,
      status: swapOffers.status,
      fromUserId: swapOffers.fromUserId,
      offeredSectionId: swapOffers.offeredSectionId,
      requestId: swapOffers.requestId,
      posterId: swapRequests.userId,
    })
    .from(swapOffers)
    .innerJoin(swapRequests, eq(swapRequests.id, swapOffers.requestId))
    .where(eq(swapOffers.id, id.data))
    .for("update", { of: swapOffers });
  if (!offer) return notFound;
  if ((role === "poster" ? offer.posterId : offer.fromUserId) !== userId) return notFound;
  if (offer.status !== "pending") return { status: 409, error: `This offer was already ${offer.status}` };
  return offer;
}

// Accept: the two requests become an accepted match straight away (both sides have said yes),
// so the chat opens immediately.
offersRouter.post("/:id/accept", async (req, res) => {
  const me = currentUser(res);

  const result = await db.transaction(async (tx): Promise<Failure | { matchId: string; offererId: string }> => {
    const offer = await lockPendingOffer(tx, req.params.id, me.id, "poster");
    if ("error" in offer) return offer;

    const [offerer] = await tx.select().from(users).where(eq(users.id, offer.fromUserId));
    if (!offerer || offerer.isBanned) return { status: 409, error: "This offer isn't available anymore" };

    // The sender may already have a request offering this section. Use it if it's free.
    const [existing] = await tx
      .select({ id: swapRequests.id })
      .from(swapRequests)
      .where(
        and(
          eq(swapRequests.userId, offer.fromUserId),
          eq(swapRequests.haveSectionId, offer.offeredSectionId),
          inArray(swapRequests.status, ["open", "matched"]),
        ),
      );

    // Lock the requests in id order, the same order matching uses, so the two can't deadlock.
    const locked = await tx
      .select({
        id: swapRequests.id,
        status: swapRequests.status,
        have: swapRequests.haveSectionId,
        createdAt: swapRequests.createdAt,
      })
      .from(swapRequests)
      .where(inArray(swapRequests.id, existing ? [offer.requestId, existing.id] : [offer.requestId]))
      .orderBy(asc(swapRequests.id))
      .for("update");
    const posting = locked.find((r) => r.id === offer.requestId);
    if (posting?.status !== "open") return { status: 409, error: "Your request isn't open anymore" };
    const theirs = existing && locked.find((r) => r.id === existing.id);
    if (theirs && theirs.status !== "open") {
      return { status: 409, error: "They're already in another swap with that section" };
    }

    const now = new Date();
    let theirRequest = theirs;
    if (!theirRequest) {
      [theirRequest] = await tx
        .insert(swapRequests)
        .values({ userId: offer.fromUserId, haveSectionId: offer.offeredSectionId })
        .returning({
          id: swapRequests.id,
          status: swapRequests.status,
          have: swapRequests.haveSectionId,
          createdAt: swapRequests.createdAt,
        });
      await tx.insert(analyticsEvents).values({ type: "request_posted" });
    }
    const pair = [posting, theirRequest!];

    // Each side now accepts the other's section, so the requests stay accurate if they ever reopen.
    await tx
      .insert(swapWants)
      .values([
        { requestId: posting.id, sectionId: offer.offeredSectionId },
        { requestId: theirRequest!.id, sectionId: posting.have },
      ])
      .onConflictDoNothing();
    await tx
      .update(swapRequests)
      .set({ status: "matched" })
      .where(inArray(swapRequests.id, pair.map((r) => r.id)));

    const oldest = [...pair].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
    const [match] = await tx
      .insert(matches)
      .values({
        size: 2,
        status: "accepted",
        expiresAt: new Date(now.getTime() + MATCH_TTL_MS),
        firstRequestId: oldest.id,
      })
      .returning({ id: matches.id });
    await tx.insert(matchMembers).values([
      {
        matchId: match!.id,
        requestId: posting.id,
        givesSectionId: posting.have,
        getsSectionId: offer.offeredSectionId,
        acceptedAt: now,
      },
      {
        matchId: match!.id,
        requestId: theirRequest!.id,
        givesSectionId: offer.offeredSectionId,
        getsSectionId: posting.have,
        acceptedAt: now,
      },
    ]);
    await tx.update(swapOffers).set({ status: "accepted", respondedAt: now }).where(eq(swapOffers.id, offer.id));
    await tx.insert(analyticsEvents).values({ type: "offer_accepted" });
    return { matchId: match!.id, offererId: offerer.id };
  });

  if ("error" in result) {
    send(res, result);
    return;
  }

  emitToUsers([me.id, result.offererId], "match:new", { matchId: result.matchId });
  const [details] = await db
    .select({ email: users.email, courseCode: courses.code })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .innerJoin(users, eq(users.id, swapRequests.userId))
    .innerJoin(sections, eq(sections.id, matchMembers.givesSectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(and(eq(matchMembers.matchId, result.matchId), eq(users.id, result.offererId)));
  if (details) {
    await sendOfferAccepted(details.email, details.courseCode, `${config.webOrigin}/matches/${result.matchId}`).catch(
      (err) => console.error(`Failed to email accepted offer for match ${result.matchId}:`, err),
    );
  }
  res.json({ matchId: result.matchId });
});

// Decline: the offer closes. Your own request stays open, unlike declining a match.
offersRouter.post("/:id/decline", async (req, res) => {
  const me = currentUser(res);
  const result = await db.transaction(async (tx) => {
    const offer = await lockPendingOffer(tx, req.params.id, me.id, "poster");
    if ("error" in offer) return offer;
    await tx
      .update(swapOffers)
      .set({ status: "declined", respondedAt: new Date() })
      .where(eq(swapOffers.id, offer.id));
    return offer;
  });
  if ("error" in result) {
    send(res, result);
    return;
  }
  emitToUsers([result.fromUserId], "offer:updated", { offerId: result.id });
  res.json({ ok: true });
});

// Withdraw an offer you sent, while it's still waiting for an answer.
offersRouter.post("/:id/withdraw", async (req, res) => {
  const me = currentUser(res);
  const result = await db.transaction(async (tx) => {
    const offer = await lockPendingOffer(tx, req.params.id, me.id, "sender");
    if ("error" in offer) return offer;
    await tx
      .update(swapOffers)
      .set({ status: "withdrawn", respondedAt: new Date() })
      .where(eq(swapOffers.id, offer.id));
    return offer;
  });
  if ("error" in result) {
    send(res, result);
    return;
  }
  emitToUsers([result.posterId], "offer:updated", { offerId: result.id });
  res.json({ ok: true });
});
