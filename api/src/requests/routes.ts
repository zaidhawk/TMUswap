import { Router } from "express";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
  analyticsEvents,
  courses,
  matches,
  matchMembers,
  sections,
  swapRequests,
  swapWants,
} from "../db/schema.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { parseBody } from "../validate.js";
import { isUniqueViolation } from "../db/errors.js";
import { tryMatchRequest } from "../matching/engine.js";

export const MAX_REQUESTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// "11" and "011" mean the same section, so store every label as 3 digits.
const sectionLabel = z
  .string({ error: "Enter a section number" })
  .trim()
  .regex(/^\d{1,3}$/, "Section numbers are 1–3 digits, like 011")
  .transform((label) => label.padStart(3, "0"));

const wantsList = z
  .array(sectionLabel, { error: "Pick at least one section you'd accept" })
  .min(1, "Pick at least one section you'd accept")
  .max(10, "You can list at most 10 sections")
  .transform((labels) => [...new Set(labels)]);

const createBody = z
  .object({
    courseId: z.uuid({ error: "Pick a course" }),
    kind: z.enum(["lecture", "lab", "tutorial"], { error: "Pick lecture, lab or tutorial" }),
    have: sectionLabel,
    wants: wantsList,
    // A coordinated drop in a wait-listed section hands the seat to a stranger.
    noWaitlist: z.literal(true, { error: "Confirm your sections have no wait list" }),
  })
  .refine((body) => !body.wants.includes(body.have), {
    message: "You can't ask for the section you already have",
  });

const updateBody = z
  .object({
    wants: wantsList.optional(),
    status: z.literal("cancelled", { error: "Requests can only be changed to cancelled" }).optional(),
  })
  .refine((body) => (body.wants === undefined) !== (body.status === undefined), {
    message: "Send either new wants or status: cancelled",
  });

// A request as the owner sees it: course, kind, the section they have and the ones they want.
async function loadRequests(where: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      id: swapRequests.id,
      status: swapRequests.status,
      createdAt: swapRequests.createdAt,
      courseId: courses.id,
      courseCode: courses.code,
      courseTitle: courses.title,
      kind: sections.kind,
      have: sections.label,
    })
    .from(swapRequests)
    .innerJoin(sections, eq(sections.id, swapRequests.haveSectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(where)
    .orderBy(desc(swapRequests.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const wants = await db
    .select({ requestId: swapWants.requestId, label: sections.label })
    .from(swapWants)
    .innerJoin(sections, eq(sections.id, swapWants.sectionId))
    .where(inArray(swapWants.requestId, ids))
    .orderBy(sections.label);

  // The match each request is currently in, if any (ended matches don't count).
  const active = await db
    .select({ requestId: matchMembers.requestId, matchId: matchMembers.matchId })
    .from(matchMembers)
    .innerJoin(matches, eq(matches.id, matchMembers.matchId))
    .where(
      and(
        inArray(matchMembers.requestId, ids),
        inArray(matches.status, ["proposed", "accepted", "counting_down"]),
      ),
    );

  return rows.map((row) => ({
    ...row,
    wants: wants.filter((w) => w.requestId === row.id).map((w) => w.label),
    matchId: active.find((a) => a.requestId === row.id)?.matchId ?? null,
  }));
}

// Finds or creates the sections with these labels and returns their ids by label.
async function upsertSections(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  courseId: string,
  kind: "lecture" | "lab" | "tutorial",
  labels: string[],
) {
  await tx
    .insert(sections)
    .values(labels.map((label) => ({ courseId, kind, label })))
    .onConflictDoNothing();
  const rows = await tx
    .select({ id: sections.id, label: sections.label })
    .from(sections)
    .where(and(eq(sections.courseId, courseId), eq(sections.kind, kind), inArray(sections.label, labels)));
  return new Map(rows.map((r) => [r.label, r.id]));
}

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

requestsRouter.get("/mine", async (_req, res) => {
  res.json({ requests: await loadRequests(eq(swapRequests.userId, currentUser(res).id)) });
});

requestsRouter.post("/", async (req, res) => {
  const user = currentUser(res);
  if (!user.displayName) {
    res.status(403).json({ error: "Pick a display name first" });
    return;
  }

  const body = parseBody(createBody, req.body, res);
  if (!body) return;

  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, body.courseId), eq(courses.term, config.currentTerm)));
  if (!course) {
    res.status(400).json({ error: "That course isn't available" });
    return;
  }

  const [recent] = await db
    .select({ n: count() })
    .from(swapRequests)
    .where(and(eq(swapRequests.userId, user.id), gt(swapRequests.createdAt, new Date(Date.now() - DAY_MS))));
  if ((recent?.n ?? 0) >= MAX_REQUESTS_PER_DAY) {
    res.status(429).json({ error: "You've posted 10 requests today. Try again tomorrow." });
    return;
  }

  let requestId: string;
  try {
    requestId = await db.transaction(async (tx) => {
      const ids = await upsertSections(tx, course.id, body.kind, [body.have, ...body.wants]);
      const [created] = await tx
        .insert(swapRequests)
        .values({ userId: user.id, haveSectionId: ids.get(body.have)! })
        .returning({ id: swapRequests.id });
      await tx
        .insert(swapWants)
        .values(body.wants.map((label) => ({ requestId: created!.id, sectionId: ids.get(label)! })));
      await tx.insert(analyticsEvents).values({ type: "request_posted" });
      return created!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "You already have an active request for that section" });
      return;
    }
    throw err;
  }

  await tryMatchRequest(requestId);
  const [created] = await loadRequests(eq(swapRequests.id, requestId));
  res.status(201).json({ request: created });
});

requestsRouter.patch("/:id", async (req, res) => {
  const user = currentUser(res);
  const id = z.uuid().safeParse(req.params.id);
  const body = parseBody(updateBody, req.body, res);
  if (!body) return;

  // Someone else's request looks exactly like one that doesn't exist.
  const [existing] = id.success
    ? await loadRequests(and(eq(swapRequests.id, id.data), eq(swapRequests.userId, user.id))!)
    : [];
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (existing.status !== "open") {
    res.status(409).json({ error: `This request is ${existing.status} and can't be changed` });
    return;
  }

  if (body.status === "cancelled") {
    const [cancelled] = await db
      .update(swapRequests)
      .set({ status: "cancelled" })
      .where(and(eq(swapRequests.id, existing.id), eq(swapRequests.status, "open")))
      .returning({ id: swapRequests.id });
    if (!cancelled) {
      res.status(409).json({ error: "This request just changed. Refresh and try again." });
      return;
    }
  } else {
    const wants = body.wants!;
    if (wants.includes(existing.have)) {
      res.status(400).json({ error: "You can't ask for the section you already have" });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      // Lock the request so it can't get matched halfway through the edit.
      const [locked] = await tx
        .select({ status: swapRequests.status })
        .from(swapRequests)
        .where(eq(swapRequests.id, existing.id))
        .for("update");
      if (locked?.status !== "open") return false;

      const ids = await upsertSections(tx, existing.courseId, existing.kind, wants);
      await tx.delete(swapWants).where(eq(swapWants.requestId, existing.id));
      await tx
        .insert(swapWants)
        .values(wants.map((label) => ({ requestId: existing.id, sectionId: ids.get(label)! })));
      return true;
    });
    if (!updated) {
      res.status(409).json({ error: "This request just changed. Refresh and try again." });
      return;
    }
    // New wants might complete a swap that wasn't possible before.
    await tryMatchRequest(existing.id);
  }

  const [updated] = await loadRequests(eq(swapRequests.id, existing.id));
  res.json({ request: updated });
});
