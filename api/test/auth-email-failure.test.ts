import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Make every email fail to send, as if Resend were down or misconfigured.
vi.mock("../src/email.js", () => ({
  sendLoginCode: vi.fn(async () => {
    throw new Error("Resend returned 403: domain not verified");
  }),
  lastCodeSentTo: vi.fn(),
}));

const { createApp } = await import("../src/app.js");
const { db, pool } = await import("../src/db/index.js");
const { loginCodes } = await import("../src/db/schema.js");
const { resetDb } = await import("./db.js");

const app = createApp();

beforeEach(resetDb);
afterAll(() => pool.end());

describe("POST /auth/request-code when email sending fails", () => {
  it("returns a clear 502 error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/auth/request-code").send({ email: "student@torontomu.ca" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("We couldn't send the email. Try again in a minute.");
  });

  it("doesn't count failed sends toward the hourly limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 5; i++) {
      await request(app).post("/auth/request-code").send({ email: "student@torontomu.ca" }).expect(502);
    }

    expect(await db.select().from(loginCodes)).toHaveLength(0);
  });
});
