import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, matches, messages, swapRequests } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { clock } from "../src/matching/countdown.js";
import { resetDb } from "./db.js";
import { loginReady } from "./helpers.js";

const app = createApp();
let courseId: string;
const realNow = clock.now;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);
  const [course] = await db.select().from(courses);
  courseId = course!.id;
  // 2 pm Toronto time: MyServiceHub is up.
  clock.now = () => new Date("2027-01-05T14:00:00-05:00");
});
afterEach(() => {
  clock.now = realNow;
});
afterAll(() => pool.end());

type Agent = Awaited<ReturnType<typeof loginReady>>["agent"];

async function post(agent: Agent, have: string, wants: string[]) {
  const res = await agent
    .post("/requests")
    .send({ courseId, kind: "lecture", have, wants, noWaitlist: true })
    .expect(201);
  return res.body.request as { id: string; matchId: string | null };
}

// ann and bob are matched. With `accepted`, both have accepted, so the chat and countdown are open.
async function pairMatch({ accepted = true } = {}) {
  const ann = await loginReady(app, "ann@torontomu.ca");
  const bob = await loginReady(app, "bob@torontomu.ca");
  const a = await post(ann.agent, "011", ["012"]);
  const b = await post(bob.agent, "012", ["011"]);
  const matchId = b.matchId!;
  if (accepted) {
    await ann.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await bob.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
  }
  return { ann: ann.agent, bob: bob.agent, annRequest: a.id, bobRequest: b.id, matchId };
}

const press = (agent: Agent, matchId: string, pressed = true) =>
  agent.post(`/matches/${matchId}/start-countdown`).send({ press: pressed });

describe("POST /matches/:id/start-countdown", () => {
  it("doesn't start after one press, and shows who has pressed", async () => {
    const { ann, matchId } = await pairMatch();

    const res = await press(ann, matchId);

    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe("accepted");
    expect(res.body.match.countdownStartsAt).toBeNull();
    expect(res.body.match.members.map((m: { pressedStart: boolean }) => m.pressedStart)).toEqual([true, false]);
  });

  it("starts 10 seconds out once everyone has pressed", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await press(ann, matchId).expect(200);

    const before = Date.now();
    const res = await press(bob, matchId);

    expect(res.body.match.status).toBe("counting_down");
    const startsIn = new Date(res.body.match.countdownStartsAt).getTime() - before;
    expect(startsIn).toBeGreaterThan(9_000);
    expect(startsIn).toBeLessThanOrEqual(11_000);
    expect(res.body.match.serverTime).toBeDefined();
  });

  it("lets you take back your press", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await press(ann, matchId).expect(200);
    await press(ann, matchId, false).expect(200);

    const res = await press(bob, matchId);

    expect(res.body.match.status).toBe("accepted");
  });

  it("is blocked during MyServiceHub's nightly downtime", async () => {
    const { ann, matchId } = await pairMatch();
    clock.now = () => new Date("2027-01-05T23:50:00-05:00");

    const res = await press(ann, matchId);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("maintenance");
    const view = await ann.get(`/matches/${matchId}`);
    expect(view.body.match.countdownBlockedReason).toContain("maintenance");
  });

  it("can't start before everyone accepts", async () => {
    const { ann, matchId } = await pairMatch({ accepted: false });

    expect((await press(ann, matchId)).status).toBe(409);
  });

  it("can't be pressed again once it has started", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await press(ann, matchId).expect(200);
    await press(bob, matchId).expect(200);

    const res = await press(ann, matchId, false);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("The countdown has already started");
  });

  it("returns 403 to non-members", async () => {
    const { matchId } = await pairMatch();
    const eve = await loginReady(app, "eve@torontomu.ca");

    expect((await press(eve.agent, matchId)).status).toBe(403);
  });
});

describe("POST /matches/:id/first-mover", () => {
  it("changes who goes first and clears everyone's presses", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await press(ann, matchId).expect(200);
    const bobMemberId = (await bob.get(`/matches/${matchId}`)).body.match.members[0].memberId;

    const res = await ann.post(`/matches/${matchId}/first-mover`).send({ memberId: bobMemberId });

    expect(res.status).toBe(200);
    const [me, other] = res.body.match.members;
    expect(me).toMatchObject({ isMe: true, goesFirst: false, pressedStart: false });
    expect(other).toMatchObject({ isMe: false, goesFirst: true });
    expect(res.body.match.steps[0]).toMatchObject({ displayName: "Student bob", action: "drop" });
  });

  it("rejects someone who isn't in the match", async () => {
    const { ann, matchId } = await pairMatch();

    const res = await ann
      .post(`/matches/${matchId}/first-mover`)
      .send({ memberId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(400);
  });

  it("can't change once the countdown has started", async () => {
    const { ann, bob, annRequest, matchId } = await pairMatch();
    await press(ann, matchId).expect(200);
    await press(bob, matchId).expect(200);

    const res = await ann.post(`/matches/${matchId}/first-mover`).send({ memberId: annRequest });

    expect(res.status).toBe(409);
  });
});

describe("POST /matches/:id/outcome", () => {
  const statusOf = async (id: string) =>
    (await db.select().from(swapRequests).where(eq(swapRequests.id, id)))[0]!.status;

  it("marks the swap completed and closes everyone's requests", async () => {
    const { ann, annRequest, bobRequest, matchId } = await pairMatch();

    const res = await ann.post(`/matches/${matchId}/outcome`).send({ outcome: "completed" });

    expect(res.body.match.status).toBe("completed");
    expect(await statusOf(annRequest)).toBe("completed");
    expect(await statusOf(bobRequest)).toBe("completed");
  });

  it("marks the swap failed and cancels the requests so people can post again", async () => {
    const { bob, annRequest, matchId } = await pairMatch();

    const res = await bob.post(`/matches/${matchId}/outcome`).send({ outcome: "failed" });

    expect(res.body.match.status).toBe("failed");
    expect(await statusOf(annRequest)).toBe("cancelled");
  });

  it("can only be reported once", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await ann.post(`/matches/${matchId}/outcome`).send({ outcome: "completed" }).expect(200);

    expect((await bob.post(`/matches/${matchId}/outcome`).send({ outcome: "failed" })).status).toBe(409);
  });

  it("can't be reported before everyone accepts", async () => {
    const { ann, matchId } = await pairMatch({ accepted: false });

    expect((await ann.post(`/matches/${matchId}/outcome`).send({ outcome: "completed" })).status).toBe(409);
  });

  it("returns 403 to non-members", async () => {
    const { matchId } = await pairMatch();
    const eve = await loginReady(app, "eve@torontomu.ca");

    const res = await eve.agent.post(`/matches/${matchId}/outcome`).send({ outcome: "failed" });

    expect(res.status).toBe(403);
    expect((await db.select().from(matches))[0]!.status).toBe("accepted");
  });
});

describe("GET /matches/:id/messages", () => {
  it("returns the newest 50, oldest first, and pages back with ?before=", async () => {
    const { ann, matchId } = await pairMatch();
    const [annUser] = await db.select({ userId: swapRequests.userId }).from(swapRequests).limit(1);
    const start = Date.now() - 60 * 60_000;
    await db.insert(messages).values(
      Array.from({ length: 60 }, (_, i) => ({
        matchId,
        senderId: annUser!.userId,
        body: `message ${i}`,
        createdAt: new Date(start + i * 1000),
      })),
    );

    const page1 = (await ann.get(`/matches/${matchId}/messages`)).body.messages;
    expect(page1).toHaveLength(50);
    expect(page1[0].body).toBe("message 10");
    expect(page1[49].body).toBe("message 59");

    const page2 = (await ann.get(`/matches/${matchId}/messages`).query({ before: page1[0].id })).body.messages;
    expect(page2.map((m: { body: string }) => m.body)).toEqual(
      Array.from({ length: 10 }, (_, i) => `message ${i}`),
    );
  });

  it("returns 403 to non-members", async () => {
    const { matchId } = await pairMatch();
    const eve = await loginReady(app, "eve@torontomu.ca");

    const res = await eve.agent.get(`/matches/${matchId}/messages`);

    expect(res.status).toBe(403);
    expect(res.body.messages).toBeUndefined();
  });
});
