import { Router } from "express";
import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { feedback } from "../db/schema.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { parseBody } from "../validate.js";
import { sendAdminAlert } from "../email.js";

export const MAX_FEEDBACK_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const feedbackBody = z.object({
  message: z
    .string({ error: "Tell us what's on your mind" })
    .trim()
    .min(10, "Tell us a bit more (at least 10 characters)")
    .max(2000, "Keep it under 2,000 characters"),
  page: z.string().trim().max(200).optional(),
});

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth);

// A bug report or suggestion from the Feedback page. Saved, and emailed to the admin with the
// page and browser it came from, so problems can be reproduced.
feedbackRouter.post("/", async (req, res) => {
  const user = currentUser(res);
  const body = parseBody(feedbackBody, req.body, res);
  if (!body) return;

  const [today] = await db
    .select({ n: count() })
    .from(feedback)
    .where(and(eq(feedback.userId, user.id), gt(feedback.createdAt, new Date(Date.now() - DAY_MS))));
  if ((today?.n ?? 0) >= MAX_FEEDBACK_PER_DAY) {
    res.status(429).json({ error: "You've sent a lot of feedback today. Email us if it's urgent." });
    return;
  }

  const [saved] = await db
    .insert(feedback)
    .values({ userId: user.id, message: body.message, page: body.page })
    .returning({ id: feedback.id });

  await sendAdminAlert(
    `Feedback from ${user.displayName ?? user.email}`,
    [
      `Feedback ${saved!.id}`,
      `From: ${user.displayName ?? "(no display name yet)"} (${user.email})`,
      `Page: ${body.page ?? "unknown"}`,
      `Browser: ${req.get("user-agent") ?? "unknown"}`,
      "",
      body.message,
    ].join("\n"),
  ).catch((err) => console.error(`Failed to email feedback ${saved!.id}:`, err));

  res.status(201).json({ ok: true });
});
