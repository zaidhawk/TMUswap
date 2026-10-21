import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, matches, matchMembers, swapRequests, swapWants } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { matchRequest, runSweep } from "../src/matching/engine.js";
import { emailsSentTo } from "../src/email.js";
import { resetDb } from "./db.js";
import { loginReady } from "./helpers.js";

const app = createApp();
let cps510: string;
let cps590: string;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [
    { code: "CPS 510", title: "Database Systems I" },
    { code: "CPS 590", title: "Operating Systems I" },
  ]);
  const rows = await db.select().from(courses);
  cps510 = rows.find((c) => c.code === "CPS 510")!.id;
  cps590 = rows.find((c) => c.code === "CPS 590")!.id;
});
afterAll(() => pool.end());

type Agent = Awaited<ReturnType<typeof loginReady>>["agent"];
type Post = { have: string; wants: string[]; kind?: string; courseId?: string };

// Posts a swap request and returns the API's view of it (status, matchId, ...).
async function post(agent: Agent, { have, wants, kind = "lecture", courseId = cps510 }: Post) {
  const res = await agent.post("/requests").send({ courseId, kind, have, wants, noWaitlist: true });
  expect(res.status).toBe(201);
  return res.body.request as { id: string; status: string; matchId: string | null };
}

const student = (name: string) => loginReady(app, `${name}@torontomu.ca`).then((s) => s.agent);
const allMatches = () => db.select().from(matches);

describe("pairs", () => {
  it("matches two students who want each other's sections", async () => {
    const ann = await student("ann");
    const bob = await student("bob");

    const a = await post(ann, { have: "011", wants: ["012"] });
    expect(a.status).toBe("open");
    const b = await post(bob, { have: "012", wants: ["011"] });

    expect(b.status).toBe("matched");
    expect(b.matchId).not.toBeNull();
    const [match] = await allMatches();
    expect(match).toMatchObject({ size: 2, status: "proposed" });
    const hoursLeft = (match!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
  });

  it("records who gives and gets which section", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, { have: "011", wants: ["012"] });
    await post(bob, { have: "012", wants: ["011"] });

    const view = (await ann.get("/requests/mine")).body.requests[0];
    const res = await ann.get(`/matches/${view.matchId}`);

    expect(res.body.match.members).toEqual([
      { displayName: "Student ann", gives: "011", gets: "012", accepted: false, isMe: true },
      { displayName: "Student bob", gives: "012", gets: "011", accepted: false, isMe: false },
    ]);
  });

  it("doesn't match when only one side wants the swap", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, { have: "011", wants: ["012"] });
    const b = await post(bob, { have: "012", wants: ["015"] });

    expect(b.status).toBe("open");
    expect(await allMatches()).toHaveLength(0);
  });

  it("never matches a student with themselves", async () => {
    const ann = await student("ann");
    await post(ann, { have: "011", wants: ["012"] });
    const second = await post(ann, { have: "012", wants: ["011"] });

    expect(second.status).toBe("open");
    expect(await allMatches()).toHaveLength(0);
  });

  it("matches the oldest waiting request first", async () => {
    const early = await student("early");
    const late = await student("late");
    const ann = await student("ann");
    const first = await post(early, { have: "012", wants: ["011"] });
    const second = await post(late, { have: "012", wants: ["011"] });

    await post(ann, { have: "011", wants: ["012"] });

    const statuses = await db.select().from(swapRequests);
    expect(statuses.find((r) => r.id === first.id)!.status).toBe("matched");
    expect(statuses.find((r) => r.id === second.id)!.status).toBe("open");
  });

  it("never matches across kinds (lecture vs lab)", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, { have: "011", wants: ["012"] });

    const b = await post(bob, { have: "012", wants: ["011"], kind: "lab" });

    expect(b.status).toBe("open");
    expect(await allMatches()).toHaveLength(0);
  });

  it("ignores cancelled requests", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const a = await post(ann, { have: "011", wants: ["012"] });
    await ann.patch(`/requests/${a.id}`).send({ status: "cancelled" }).expect(200);

    const b = await post(bob, { have: "012", wants: ["011"] });

    expect(b.status).toBe("open");
  });

  it("matches after an edit makes the swap possible", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, { have: "011", wants: ["012"] });
    const b = await post(bob, { have: "012", wants: ["015"] });

    const res = await bob.patch(`/requests/${b.id}`).send({ wants: ["015", "011"] });

    expect(res.body.request.status).toBe("matched");
  });

  it("emails everyone in the match with a link", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, { have: "011", wants: ["012"] });
    const b = await post(bob, { have: "012", wants: ["011"] });

    for (const email of ["ann@torontomu.ca", "bob@torontomu.ca"]) {
      const mail = emailsSentTo(email).findLast((e) => e.subject === "You have a swap match for CPS 510");
      expect(mail?.text).toContain(`/matches/${b.matchId}`);
    }
  });
});

describe("triangles", () => {
  it("finds a 3-way swap when no pair exists", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const cat = await student("cat");
    await post(ann, { have: "011", wants: ["012"] });
    await post(bob, { have: "012", wants: ["013"] });
    const c = await post(cat, { have: "013", wants: ["011"] });

    expect(c.status).toBe("matched");
    const res = await cat.get(`/matches/${c.matchId}`);
    expect(res.body.match.size).toBe(3);
    // Starting from cat: cat gives 013 and gets 011 from ann, and so on around the circle.
    expect(res.body.match.members.map((m: { displayName: string; gives: string; gets: string }) => [m.displayName, m.gives, m.gets])).toEqual([
      ["Student cat", "013", "011"],
      ["Student ann", "011", "012"],
      ["Student bob", "012", "013"],
    ]);
  });

  it("prefers a pair over a triangle", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const dan = await student("dan");
    const cat = await student("cat");
    await post(ann, { have: "011", wants: ["012"] });
    await post(bob, { have: "012", wants: ["013"] });
    await post(dan, { have: "011", wants: ["013"] }); // a direct partner for cat
    const c = await post(cat, { have: "013", wants: ["011"] });

    // cat could do a triangle with ann and bob, but dan is a direct swap, which is simpler.
    const res = await cat.get(`/matches/${c.matchId}`);
    expect(res.body.match.size).toBe(2);
    expect(res.body.match.members[1].displayName).toBe("Student dan");
  });
});

describe("reserving", () => {
  it("lets only one match claim a request when two race for it", async () => {
    const bob = await student("bob");
    const b = await post(bob, { have: "012", wants: ["011"] });
    // ann and amy both have 011. They post wanting something else, so no match happens yet...
    const a1 = await post(await student("ann"), { have: "011", wants: ["015"] });
    const a2 = await post(await student("amy"), { have: "011", wants: ["015"] });
    // ...then both start wanting bob's 012, added directly so matching doesn't run.
    await addWant(a1.id, b.id);
    await addWant(a2.id, b.id);

    // Hold bob's row from another connection, so both matchers get stuck at the same point
    // and then continue together. Left to chance, one usually finishes before the other starts.
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM swap_requests WHERE id = $1 FOR UPDATE", [b.id]);
    const racing = Promise.all([matchRequest(a1.id), matchRequest(a2.id)]);
    await waitForLockWaiters(2);
    await blocker.query("COMMIT");
    blocker.release();
    const results = await racing;

    expect(results.filter((id) => id !== null)).toHaveLength(1);
    expect(await allMatches()).toHaveLength(1);
    expect(await db.select().from(matchMembers).where(eq(matchMembers.requestId, b.id))).toHaveLength(1);
  });

  it("the sweep matches requests that were missed", async () => {
    const a = await post(await student("ann"), { have: "011", wants: ["012"] });
    const b = await post(await student("bob"), { have: "012", wants: ["015"] });
    // Make bob want ann's section behind the API's back, so no matching ran.
    await addWant(b.id, a.id);

    await runSweep();

    expect(await allMatches()).toHaveLength(1);
  });
});

// Waits until `n` database sessions are blocked waiting for a row lock.
async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 250; i++) {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
    );
    if (rows[0]!.n >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${n} sessions waiting on a lock`);
}

// Makes request `fromId` also want the section that request `toId` has, without triggering matching.
async function addWant(fromId: string, toId: string) {
  const [to] = await db.select().from(swapRequests).where(eq(swapRequests.id, toId));
  await db.insert(swapWants).values({ requestId: fromId, sectionId: to!.haveSectionId });
}

describe("never matching across courses", () => {
  it("keeps courses apart even with identical section numbers", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, { have: "011", wants: ["012"], courseId: cps510 });
    const b = await post(bob, { have: "012", wants: ["011"], courseId: cps590 });

    expect(b.status).toBe("open");
  });
});
