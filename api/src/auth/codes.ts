import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODES_PER_HOUR = 3;
export const MAX_ATTEMPTS = 5;

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// HMAC instead of a plain hash: there are only a million possible codes, so a plain
// SHA-256 could be reversed instantly by trying them all. The secret key prevents that.
export function hashCode(code: string): string {
  return createHmac("sha256", config.authSecret).update(code).digest("hex");
}

// Compares in constant time, so response timing doesn't reveal how close a guess was.
export function codesMatch(storedHash: string, guessHash: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(guessHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
