import type { RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users, type User } from "../db/schema.js";
import { SESSION_COOKIE, hashToken } from "./sessions.js";

// Rejects the request unless it carries a valid session cookie for a user who isn't banned.
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") {
    res.status(401).json({ error: "Not logged in" });
    return;
  }

  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, hashToken(token)));

  if (!row || row.expiresAt <= new Date()) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  if (row.user.isBanned) {
    res.status(403).json({ error: "This account has been banned" });
    return;
  }

  res.locals.user = row.user;
  next();
};

// The logged-in user. Only call this in routes behind requireAuth.
export function currentUser(res: Response): User {
  const user = res.locals.user;
  if (!user) throw new Error("currentUser() called on a route without requireAuth");
  return user;
}

// What a user may see about themselves. Other users will only ever see displayName.
export function toPublicUser(user: User) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
