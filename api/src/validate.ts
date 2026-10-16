import type { Response } from "express";
import type { z } from "zod";

// Returns the parsed body, or sends a 400 with the first problem and returns undefined.
export function parseBody<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return undefined;
  }
  return parsed.data;
}
