import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { loginCodes } from "../src/db/schema.js";
import { hashCode } from "../src/auth/codes.js";
import { lastCodeSentTo } from "../src/email.js";
import { resetDb } from "./db.js";

const app = createApp();
const requestCode = (body: object) => request(app).post("/auth/request-code").send(body);

beforeEach(resetDb);
afterAll(() => pool.end());

describe("POST /auth/request-code", () => {
  it("sends a 6-digit code and stores only its hash", async () => {
    const res = await requestCode({ email: "student@torontomu.ca" });

    expect(res.status).toBe(200);
    const code = lastCodeSentTo("student@torontomu.ca");
    expect(code).toMatch(/^\d{6}$/);

    const rows = await db.select().from(loginCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).toBe(hashCode(code!));
    expect(rows[0]!.codeHash).not.toContain(code);
  });

  it("expires the code in 10 minutes", async () => {
    await requestCode({ email: "student@torontomu.ca" });

    const [row] = await db.select().from(loginCodes);
    const minutesLeft = (row!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(9.9);
    expect(minutesLeft).toBeLessThanOrEqual(10);
  });

  it("normalizes the email's case and spaces", async () => {
    await requestCode({ email: "  Student@TorontoMU.ca " });

    const [row] = await db.select().from(loginCodes);
    expect(row!.email).toBe("student@torontomu.ca");
  });

  it.each([
    ["a non-TMU email", { email: "student@gmail.com" }, "Use your @torontomu.ca email"],
    ["a look-alike domain", { email: "student@torontomu.ca.evil.com" }, "Use your @torontomu.ca email"],
    ["an invalid email", { email: "not-an-email" }, "Enter a valid email address"],
    ["a missing email", {}, "Email is required"],
  ])("rejects %s", async (_name, body, message) => {
    const res = await requestCode(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await db.select().from(loginCodes)).toHaveLength(0);
  });

  it("allows 3 codes per hour, then returns 429", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await requestCode({ email: "student@torontomu.ca" })).status).toBe(200);
    }

    const res = await requestCode({ email: "student@torontomu.ca" });
    expect(res.status).toBe(429);
    expect(await db.select().from(loginCodes)).toHaveLength(3);
  });

  it("does not count codes older than an hour", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.insert(loginCodes).values(
      Array.from({ length: 3 }, () => ({
        email: "student@torontomu.ca",
        codeHash: "old",
        expiresAt: twoHoursAgo,
        createdAt: twoHoursAgo,
      })),
    );

    expect((await requestCode({ email: "student@torontomu.ca" })).status).toBe(200);
  });

  it("limits each email separately", async () => {
    for (let i = 0; i < 3; i++) await requestCode({ email: "a@torontomu.ca" });

    const res = await requestCode({ email: "b@torontomu.ca" });
    expect(res.status).toBe(200);
    expect(await db.select().from(loginCodes).where(eq(loginCodes.email, "b@torontomu.ca"))).toHaveLength(1);
  });
});
