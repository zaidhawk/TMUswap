import { Router } from "express";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { loginCodes, sessions, users } from "../db/schema.js";
import { sendLoginCode } from "../email.js";
import { parseBody } from "../validate.js";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_CODES_PER_HOUR,
  codesMatch,
  generateCode,
  hashCode,
} from "./codes.js";
import { currentUser, requireAuth, toPublicUser } from "./middleware.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  hashToken,
  sessionCookieOptions,
} from "./sessions.js";

const HOUR_MS = 60 * 60 * 1000;

const tmuEmail = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"))
  .refine((email) => email.endsWith("@torontomu.ca"), "Use your @torontomu.ca email");

const requestCodeBody = z.object({ email: tmuEmail });

const verifyBody = z.object({
  email: tmuEmail,
  code: z
    .string({ error: "Code is required" })
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const updateMeBody = z.object({
  displayName: z
    .string({ error: "Display name is required" })
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(30, "Display name must be at most 30 characters"),
});

const expiredCode = { error: "This code has expired. Request a new one." };

export const authRouter = Router();

authRouter.post("/request-code", async (req, res) => {
  const body = parseBody(requestCodeBody, req.body, res);
  if (!body) return;
  const { email } = body;

  const [recent] = await db
    .select({ n: count() })
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, new Date(Date.now() - HOUR_MS))));
  if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) {
    res.status(429).json({ error: "Too many codes requested. Try again in an hour." });
    return;
  }

  const code = generateCode();
  const [row] = await db
    .insert(loginCodes)
    .values({
      email,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .returning({ id: loginCodes.id });

  try {
    await sendLoginCode(email, code);
  } catch (err) {
    // The student never got this code, so it shouldn't count toward their hourly limit.
    await db.delete(loginCodes).where(eq(loginCodes.id, row!.id));
    console.error("Failed to send login code:", err);
    res.status(502).json({ error: "We couldn't send the email. Try again in a minute." });
    return;
  }

  res.json({ ok: true });
});

authRouter.post("/verify", async (req, res) => {
  const body = parseBody(verifyBody, req.body, res);
  if (!body) return;
  const { email, code } = body;

  // Only the most recent code for this email can be used.
  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(eq(loginCodes.email, email))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!latest || latest.usedAt || latest.expiresAt <= new Date()) {
    res.status(400).json(expiredCode);
    return;
  }

  // Count the attempt in one atomic UPDATE, so parallel guesses can't slip past the limit.
  const [counted] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(
      and(
        eq(loginCodes.id, latest.id),
        lt(loginCodes.attempts, MAX_ATTEMPTS),
        isNull(loginCodes.usedAt),
      ),
    )
    .returning();
  if (!counted) {
    res.status(429).json({ error: "Too many attempts. Request a new code." });
    return;
  }

  if (!codesMatch(counted.codeHash, hashCode(code))) {
    res.status(400).json({ error: "Incorrect code" });
    return;
  }

  // Mark it used, again atomically, so the same code can't log in twice.
  const [used] = await db
    .update(loginCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(loginCodes.id, counted.id), isNull(loginCodes.usedAt)))
    .returning();
  if (!used) {
    res.status(400).json(expiredCode);
    return;
  }

  // First login creates the account.
  await db.insert(users).values({ email }).onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`User ${email} missing after insert`);
  if (user.isBanned) {
    res.status(403).json({ error: "This account has been banned" });
    return;
  }

  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_TTL_MS });
  res.json({ user: toPublicUser(user) });
});

authRouter.get("/me", requireAuth, (_req, res) => {
  res.json({ user: toPublicUser(currentUser(res)) });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const body = parseBody(updateMeBody, req.body, res);
  if (!body) return;

  const [user] = await db
    .update(users)
    .set({ displayName: body.displayName })
    .where(eq(users.id, currentUser(res).id))
    .returning();
  res.json({ user: toPublicUser(user!) });
});

authRouter.post("/logout", async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  res.json({ ok: true });
});
