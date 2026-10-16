import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { sessions, users } from "../src/db/schema.js";
import { resetDb } from "./db.js";
import { login } from "./helpers.js";

const app = createApp();

beforeEach(resetDb);
afterAll(() => pool.end());

describe("GET /auth/me", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.status).toBe(401);
  });

  it("returns 401 for a made-up session cookie", async () => {
    const res = await request(app).get("/auth/me").set("Cookie", "sid=not-a-real-session");

    expect(res.status).toBe(401);
  });

  it("returns the logged-in user", async () => {
    const { agent } = await login(app);

    const res = await agent.get("/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "student@torontomu.ca", displayName: null });
  });

  it("returns 401 once the session has expired", async () => {
    const { agent } = await login(app);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await agent.get("/auth/me");

    expect(res.status).toBe(401);
  });

  it("returns 403 if the user is banned after logging in", async () => {
    const { agent } = await login(app);
    await db.update(users).set({ isBanned: true });

    const res = await agent.get("/auth/me");

    expect(res.status).toBe(403);
  });
});

describe("PATCH /auth/me", () => {
  it("sets the display name", async () => {
    const { agent } = await login(app);

    const res = await agent.patch("/auth/me").send({ displayName: "  Zaid  " });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("Zaid");
    expect((await agent.get("/auth/me")).body.user.displayName).toBe("Zaid");
  });

  it.each([
    ["too short", "Z", "Display name must be at least 2 characters"],
    ["too long", "x".repeat(31), "Display name must be at most 30 characters"],
    ["only spaces", "     ", "Display name must be at least 2 characters"],
  ])("rejects a name that is %s", async (_name, displayName, message) => {
    const { agent } = await login(app);

    const res = await agent.patch("/auth/me").send({ displayName });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it("requires login", async () => {
    const res = await request(app).patch("/auth/me").send({ displayName: "Zaid" });

    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("ends the session so the cookie stops working", async () => {
    const { agent, res: loginRes } = await login(app);
    const oldCookie = loginRes.headers["set-cookie"]!;

    await agent.post("/auth/logout").expect(200);

    expect(await db.select().from(sessions)).toHaveLength(0);
    // Even if someone kept a copy of the old cookie, it no longer works.
    const res = await request(app).get("/auth/me").set("Cookie", oldCookie);
    expect(res.status).toBe(401);
  });

  it("only ends the current session", async () => {
    const phone = await login(app);
    const laptop = await login(app);

    await phone.agent.post("/auth/logout").expect(200);

    expect((await laptop.agent.get("/auth/me")).status).toBe(200);
  });

  it("succeeds even when not logged in", async () => {
    await request(app).post("/auth/logout").expect(200);
  });
});
