import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(createApp()).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(createApp()).get("/does-not-exist");

    expect(res.status).toBe(404);
  });
});
