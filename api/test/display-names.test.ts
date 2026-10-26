import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { isProfane } from "../src/auth/profanity.js";
import { resetDb } from "./db.js";
import { login } from "./helpers.js";

const app = createApp();

beforeEach(resetDb);
afterAll(() => pool.end());

describe("isProfane", () => {
  it.each(["fuck", "FuCk", "fuuuck", "sh1t", "b1tch", "a$$hole", "c0ck", "motherfucker", "Big Dick Energy"])(
    "catches %s",
    (name) => expect(isProfane(name)).toBe(true),
  );

  it.each(["f u c k", "f.u.c.k", "s-h-i-t"])("catches letters spaced out like %s", (name) =>
    expect(isProfane(name)).toBe(true),
  );

  // Real names and words that only contain a swear word inside them.
  it.each([
    "Cassandra",
    "Hancock",
    "Scunthorpe",
    "Titus",
    "Sussex",
    "Cockburn",
    "Shitake",
    "Bass Player",
    "Dickson",
    "Analise",
    "Daquan",
    "Jerome",
    "Pen Island",
    "J R R Tolkien",
  ])("allows %s", (name) => expect(isProfane(name)).toBe(false));
});

describe("PATCH /auth/me", () => {
  it("rejects a display name with a swear word", async () => {
    const { agent } = await login(app, "ann@torontomu.ca");

    const res = await agent.patch("/auth/me").send({ displayName: "Sh1t Head" }).expect(400);

    expect(res.body.error).toBe("That display name isn't allowed. Pick a different one.");
    expect((await agent.get("/auth/me").expect(200)).body.user.displayName).toBeNull();
  });

  it("rejects it when renaming later too", async () => {
    const { agent } = await login(app, "ann@torontomu.ca");
    await agent.patch("/auth/me").send({ displayName: "Ann" }).expect(200);

    await agent.patch("/auth/me").send({ displayName: "f u c k" }).expect(400);

    expect((await agent.get("/auth/me").expect(200)).body.user.displayName).toBe("Ann");
  });

  it("accepts an ordinary name", async () => {
    const { agent } = await login(app, "ann@torontomu.ca");

    const res = await agent.patch("/auth/me").send({ displayName: "Cassandra" }).expect(200);

    expect(res.body.user.displayName).toBe("Cassandra");
  });
});
