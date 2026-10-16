import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions } from "express";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The cookie holds a random token; the database holds only its hash, so a leaked
// sessions table can't be used to log in. Plain SHA-256 is enough here because the
// token is 256 random bits, far too many to guess (unlike a 6-digit code).
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true, // page JavaScript can't read it, so an XSS bug can't steal it
  secure: config.isProduction, // HTTPS only in production; localhost is plain HTTP
  sameSite: "lax", // not sent on requests started by other sites, which blocks most CSRF
  path: "/",
};
