import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { db, pool } from "../src/db/index.js";
import { analyticsEvents, courses, matches } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { loadStats, STATS_DAYS } from "../src/admin/routes.js";
import { resetDb } from "./db.js";
import { login, loginReady } from "./helpers.js";

const app = createApp();
const ADMIN = "boss@torontomu.ca";
let courseId: string;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);
  courseId = (await db.select().from(courses))[0]!.id;
  config.adminLogins = [ADMIN];
});
afterEach(() => {
  config.adminLogins = [];
});
afterAll(() => pool.end());

type Agent = Awaited<ReturnType<typeof loginReady>>["agent"];

const student = (name: string) => loginReady(app, `${name}@torontomu.ca`).then((s) => s.agent);

async function post(agent: Agent, have: string, wants: string[]) {
  const res = await agent
    .post("/requests")
    .send({ courseId, kind: "lecture", have, wants, noWaitlist: true })
    .expect(201);
  return res.body.request as { id: string; matchId: string | null };
}

const totals = async () => (await loadStats()).totals;

describe("who can see the stats", () => {
  it("shows them to an admin", async () => {
    const { agent } = await login(app, ADMIN);
    const res = await agent.get("/admin/stats").expect(200);

    expect(res.body.totals).toMatchObject({ signUps: 1, accounts: 1 });
    expect(res.body.days).toHaveLength(STATS_DAYS);
  });

  it("looks like a missing page to everyone else", async () => {
    const ann = await student("ann");
    const res = await ann.get("/admin/stats").expect(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("needs a login", async () => {
    await request(app).get("/admin/stats").expect(401);
  });

  it("tells the web app whether you're an admin", async () => {
    const admin = await login(app, ADMIN);
    const ann = await login(app, "ann@torontomu.ca");

    expect(admin.res.body.user.isAdmin).toBe(true);
    expect(ann.res.body.user.isAdmin).toBe(false);
    expect((await ann.agent.get("/auth/me").expect(200)).body.user.isAdmin).toBe(false);
  });
});

describe("totals", () => {
  it("count a sign-up once per account, not once per login", async () => {
    await login(app, "ann@torontomu.ca");
    await login(app, "ann@torontomu.ca");

    expect(await totals()).toMatchObject({ signUps: 1, accounts: 1 });
  });

  it("follow a swap from posting to completed", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, "011", ["012"]);
    const { matchId } = await post(bob, "012", ["011"]);
    await ann.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await bob.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await ann.post(`/matches/${matchId}/outcome`).send({ outcome: "completed" }).expect(200);

    expect(await totals()).toEqual({
      signUps: 2,
      accounts: 2,
      requestsPosted: 2,
      openRequests: 0,
      offersSent: 0,
      offersAccepted: 0,
      matches: 1,
      threeWayMatches: 0,
      acceptedMatches: 1,
      completedSwaps: 1,
      failedSwaps: 0,
      studentsSwapped: 2,
    });
  });

  it("count 3-way matches separately", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const cat = await student("cat");
    await post(ann, "011", ["012"]);
    await post(bob, "012", ["013"]);
    await post(cat, "013", ["011"]);

    expect(await totals()).toMatchObject({ matches: 1, threeWayMatches: 1, acceptedMatches: 0 });
  });

  it("count failed swaps, which still got everyone's yes", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, "011", ["012"]);
    const { matchId } = await post(bob, "012", ["011"]);
    await ann.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await bob.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await bob.post(`/matches/${matchId}/outcome`).send({ outcome: "failed" }).expect(200);

    expect(await totals()).toMatchObject({ acceptedMatches: 1, completedSwaps: 0, failedSwaps: 1 });
  });

  it("don't shrink when someone deletes their account", async () => {
    const ann = await student("ann");
    await post(ann, "011", ["012"]);
    await ann.delete("/auth/me").send({ confirm: true }).expect(200);

    expect(await totals()).toMatchObject({ signUps: 1, accounts: 0, requestsPosted: 1, openRequests: 0 });
  });

  it("only count requests that were actually posted", async () => {
    const ann = await student("ann");
    await post(ann, "011", ["012"]);
    // Same seat again: rejected, so it mustn't count.
    await ann
      .post("/requests")
      .send({ courseId, kind: "lecture", have: "011", wants: ["013"], noWaitlist: true })
      .expect(409);

    expect(await totals()).toMatchObject({ requestsPosted: 1, openRequests: 1 });
  });
});

describe("by day", () => {
  // Nov 20, 10 am in Toronto. Daylight saving has ended, so Toronto is UTC-5.
  const now = new Date("2026-11-20T15:00:00Z");
  const signUpAt = (iso: string) => db.insert(analyticsEvents).values({ type: "signed_up", createdAt: new Date(iso) });

  it("lists the last 14 days, newest first, including empty ones", async () => {
    const { days } = await loadStats(now);

    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: "2026-11-20", signUps: 0, requestsPosted: 0, matches: 0, completedSwaps: 0 });
    expect(days[13]!.date).toBe("2026-11-07");
  });

  it("goes by Toronto's date, not UTC's", async () => {
    await signUpAt("2026-11-20T04:30:00Z"); // 11:30 pm on Nov 19 in Toronto
    await signUpAt("2026-11-20T05:30:00Z"); // 12:30 am on Nov 20 in Toronto

    const { days } = await loadStats(now);
    expect(days[0]).toMatchObject({ date: "2026-11-20", signUps: 1 });
    expect(days[1]).toMatchObject({ date: "2026-11-19", signUps: 1 });
  });

  it("leaves out anything older than 14 days", async () => {
    await signUpAt("2026-11-07T17:00:00Z");
    await signUpAt("2026-11-06T17:00:00Z");

    const { days } = await loadStats(now);
    expect(days[13]).toMatchObject({ date: "2026-11-07", signUps: 1 });
    expect(days.reduce((sum, d) => sum + d.signUps, 0)).toBe(1);
  });

  it("puts a match on the day it was made, and a completed swap on the day it finished", async () => {
    await db.insert(matches).values({
      size: 2,
      status: "completed",
      createdAt: new Date("2026-11-17T17:00:00Z"),
      expiresAt: new Date("2026-11-18T17:00:00Z"),
      closedAt: new Date("2026-11-18T17:00:00Z"),
    });

    const { days } = await loadStats(now);
    expect(days.find((d) => d.date === "2026-11-17")).toMatchObject({ matches: 1, completedSwaps: 0 });
    expect(days.find((d) => d.date === "2026-11-18")).toMatchObject({ matches: 0, completedSwaps: 1 });
  });
});
