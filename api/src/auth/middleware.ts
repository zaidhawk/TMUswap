import type { RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { sessions, users, type User } from "../db/schema.js";
import { SESSION_COOKIE, hashToken } from "./sessions.js";

// The user a session token belongs to, or null if the session doesn't exist or has expired.
// Used for both HTTP requests and WebSocket connections.
export async function findSessionUser(token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, hashToken(token)));
  return row && row.expiresAt > new Date() ? row.user : null;
}

// Rejects the request unless it carries a valid session cookie for a user who isn't banned.
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const user = typeof token === "string" ? await findSessionUser(token) : null;
  if (!user) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  if (user.isBanned) {
    res.status(403).json({ error: "This account has been banned" });
    return;
  }

  res.locals.user = user;
  next();
};

// The logged-in user. Only call this in routes behind requireAuth.
export function currentUser(res: Response): User {
  const user = res.locals.user;
  if (!user) throw new Error("currentUser() called on a route without requireAuth");
  return user;
}

export function isAdmin(user: User): boolean {
  return config.adminLogins.includes(user.email);
}

// Admin-only routes. Other logged-in users get a 404, as if the route didn't exist. Use after requireAuth.
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (!isAdmin(currentUser(res))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
};

// What a user may see about themselves. Other users will only ever see displayName.
export function toPublicUser(user: User) {
  return { id: user.id, email: user.email, displayName: user.displayName, isAdmin: isAdmin(user) };
}
