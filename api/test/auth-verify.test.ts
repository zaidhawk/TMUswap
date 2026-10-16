import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { loginCodes, sessions, users } from "../src/db/schema.js";
import { hashToken } from "../src/auth/sessions.js";
import { lastCodeSentTo } from "../src/email.js";
import { resetDb } from "./db.js";
import { sessionCookie } from "./helpers.js";

const app = createApp();
const EMAIL = "student@torontomu.ca";

async function requestCode(email = EMAIL) {
  await request(app).post("/auth/request-code").send({ email }).expect(200);
  return lastCodeSentTo(email)!;
}
const verify = (body: object) => request(app).post("/auth/verify").send(body);

// A code guaranteed not to be the real one.
const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

beforeEach(resetDb);
afterAll(() => pool.end());

describe("POST /auth/verify", () => {
  it("logs in with the right code and sets a secure session cookie", async () => {
    const code = await requestCode();

    const res = await verify({ email: EMAIL, code });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: EMAIL, displayName: null });
    const cookie = sessionCookie(res);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
  });

  it("stores only a hash of the session token", async () => {
    const res = await verify({ email: EMAIL, code: await requestCode() });

    const token = sessionCookie(res)!.split(";")[0]!.slice("sid=".length);
    const [row] = await db.select().from(sessions);
    expect(row!.id).toBe(hashToken(token));
    expect(row!.id).not.toBe(token);
  });

  it("creates the account on first login and reuses it after", async () => {
    await verify({ email: EMAIL, code: await requestCode() }).expect(200);
    await verify({ email: EMAIL, code: await requestCode() }).expect(200);

    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(2);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const code = await requestCode();

    const res = await verify({ email: EMAIL, code: wrongCode(code) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Incorrect code");
    expect(sessionCookie(res)).toBeUndefined();
    const [row] = await db.select().from(loginCodes);
    expect(row!.attempts).toBe(1);
  });

  it("locks the code after 5 attempts, even if the 6th is right", async () => {
    const code = await requestCode();
    for (let i = 0; i < 5; i++) {
      await verify({ email: EMAIL, code: wrongCode(code) }).expect(400);
    }

    const res = await verify({ email: EMAIL, code });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too many attempts. Request a new code.");
  });

  it("can't be beaten by sending many guesses at once", async () => {
    const code = await requestCode();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => verify({ email: EMAIL, code: wrongCode(code) })),
    );

    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
    const [row] = await db.select().from(loginCodes);
    expect(row!.attempts).toBe(5);
  });

  it("rejects an expired code", async () => {
    const code = await requestCode();
    await db.update(loginCodes).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await verify({ email: EMAIL, code });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This code has expired. Request a new one.");
  });

  it("rejects a code that was already used", async () => {
    const code = await requestCode();
    await verify({ email: EMAIL, code }).expect(200);

    const res = await verify({ email: EMAIL, code });

    expect(res.status).toBe(400);
  });

  it("only accepts the newest code", async () => {
    const oldCode = await requestCode();
    const newCode = await requestCode();
    if (oldCode === newCode) return; // 1-in-a-million chance the codes are equal

    await verify({ email: EMAIL, code: oldCode }).expect(400);
    await verify({ email: EMAIL, code: newCode }).expect(200);
  });

  it("rejects one email's code used for another email", async () => {
    const code = await requestCode("a@torontomu.ca");
    await requestCode("b@torontomu.ca");

    const res = await verify({ email: "b@torontomu.ca", code });

    // Could only pass if both random codes happened to match.
    if (code !== lastCodeSentTo("b@torontomu.ca")) expect(res.status).toBe(400);
  });

  it("rejects a request when no code was sent", async () => {
    const res = await verify({ email: EMAIL, code: "123456" });

    expect(res.status).toBe(400);
  });

  it.each([
    ["letters in the code", { email: EMAIL, code: "12ab56" }, "Enter the 6-digit code"],
    ["a short code", { email: EMAIL, code: "12345" }, "Enter the 6-digit code"],
    ["a missing code", { email: EMAIL }, "Code is required"],
    ["a non-TMU email", { email: "a@gmail.com", code: "123456" }, "Use your @torontomu.ca email"],
  ])("rejects %s", async (_name, body, message) => {
    const res = await verify(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it("refuses to log in a banned user", async () => {
    await db.insert(users).values({ email: EMAIL, isBanned: true });

    const res = await verify({ email: EMAIL, code: await requestCode() });

    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
