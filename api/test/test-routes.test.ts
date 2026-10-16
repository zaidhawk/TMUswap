import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { resetDb } from "./db.js";

beforeEach(resetDb);
afterAll(() => pool.end());

describe("GET /test/last-code", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("returns the last code sent to an email", async () => {
    const app = createApp();
    await request(app).post("/auth/request-code").send({ email: "e2e@torontomu.ca" }).expect(200);

    const res = await request(app).get("/test/last-code").query({ email: "e2e@torontomu.ca" });

    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^\d{6}$/);
  });

  it("returns 404 for an email that was never sent a code", async () => {
    const res = await request(createApp()).get("/test/last-code").query({ email: "nobody@torontomu.ca" });

    expect(res.status).toBe(404);
  });

  it("does not exist in production", async () => {
    process.env.NODE_ENV = "production";

    const res = await request(createApp()).get("/test/last-code").query({ email: "e2e@torontomu.ca" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
  });
});
