import { Router } from "express";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { matchMembers, reports, swapRequests, users } from "../db/schema.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { parseBody } from "../validate.js";
import { sendAdminAlert } from "../email.js";
import { loadMessages, matchCourseCode } from "../chat/service.js";

export const MAX_REPORTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const reportBody = z.object({
  matchId: z.uuid({ error: "Pick the match" }),
  memberId: z.uuid({ error: "Pick who you're reporting" }),
  reason: z
    .string({ error: "Tell us what happened" })
    .trim()
    .min(10, "Tell us what happened (at least 10 characters)")
    .max(1000, "Keep it under 1,000 characters"),
});

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// Report someone you were matched with. The admin gets an email with the reason and the
// recent chat, and decides whether to ban them.
reportsRouter.post("/", async (req, res) => {
  const reporter = currentUser(res);
  const body = parseBody(reportBody, req.body, res);
  if (!body) return;

  const members = await db
    .select({ requestId: matchMembers.requestId, userId: swapRequests.userId })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .where(eq(matchMembers.matchId, body.matchId));
  if (!members.some((m) => m.userId === reporter.id)) {
    res.status(403).json({ error: "You're not part of this match" });
    return;
  }
  const reported = members.find((m) => m.requestId === body.memberId);
  if (!reported || reported.userId === reporter.id) {
    res.status(400).json({ error: "Pick someone else in this match" });
    return;
  }

  const [already] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterId, reporter.id),
        eq(reports.reportedUserId, reported.userId),
        eq(reports.matchId, body.matchId),
        isNull(reports.resolvedAt),
      ),
    );
  if (already) {
    res.status(409).json({ error: "You've already reported this person. We'll look into it." });
    return;
  }

  const [today] = await db
    .select({ n: count() })
    .from(reports)
    .where(and(eq(reports.reporterId, reporter.id), gt(reports.createdAt, new Date(Date.now() - DAY_MS))));
  if ((today?.n ?? 0) >= MAX_REPORTS_PER_DAY) {
    res.status(429).json({ error: "You've sent several reports today. Email us if it's urgent." });
    return;
  }

  const [saved] = await db
    .insert(reports)
    .values({
      reporterId: reporter.id,
      reportedUserId: reported.userId,
      matchId: body.matchId,
      reason: body.reason,
    })
    .returning({ id: reports.id });

  const [reportedUser] = await db.select().from(users).where(eq(users.id, reported.userId));
  const recent = await loadMessages(body.matchId);
  await sendAdminAlert(
    `Report in ${(await matchCourseCode(body.matchId)) ?? "a"} match`,
    [
      `Report ${saved!.id}`,
      `From: ${reporter.displayName} (${reporter.email})`,
      `About: ${reportedUser?.displayName} (${reportedUser?.email})`,
      "",
      `Reason: ${body.reason}`,
      "",
      "Recent messages:",
      ...recent.slice(-20).map((m) => `  ${m.senderName}: ${m.body}`),
      "",
      "To ban, run the SQL in the README's Admin section with their email.",
    ].join("\n"),
  ).catch((err) => console.error(`Failed to email report ${saved!.id}:`, err));

  res.status(201).json({ ok: true });
});
