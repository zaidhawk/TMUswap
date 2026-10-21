import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, matches, matchMembers, swapRequests } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { expireDueMatches, runSweep } from "../src/matching/engine.js";
import { resetDb } from "./db.js";
import { loginReady } from "./helpers.js";

const app = createApp();
let courseId: string;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);
  const [course] = await db.select().from(courses);
  courseId = course!.id;
});
afterAll(() => pool.end());

type Agent = Awaited<ReturnType<typeof loginReady>>["agent"];

const student = (name: string) => loginReady(app, `${name}@torontomu.ca`).then((s) => s.agent);

async function post(agent: Agent, have: string, wants: string[]) {
  const res = await agent
    .post("/requests")
    .send({ courseId, kind: "lecture", have, wants, noWaitlist: true })
    .expect(201);
  return res.body.request as { id: string; status: string; matchId: string | null };
}

// ann (011) and bob (012) want each other's sections, so they're matched.
async function pairMatch() {
  const ann = await student("ann");
  const bob = await student("bob");
  const a = await post(ann, "011", ["012"]);
  const b = await post(bob, "012", ["011"]);
  return { ann, bob, annRequest: a.id, bobRequest: b.id, matchId: b.matchId! };
}

const statusOf = async (requestId: string) =>
  (await db.select().from(swapRequests).where(eq(swapRequests.id, requestId)))[0]!.status;
const matchStatus = async (matchId: string) =>
  (await db.select().from(matches).where(eq(matches.id, matchId)))[0]!.status;
const answer = (agent: Agent, matchId: string, accept: boolean) =>
  agent.post(`/matches/${matchId}/accept`).send({ accept });

describe("GET /matches/:id", () => {
  it("shows the match to its members, by display name only", async () => {
    const { ann, matchId } = await pairMatch();

    const res = await ann.get(`/matches/${matchId}`);

    expect(res.status).toBe(200);
    expect(res.body.match).toMatchObject({
      courseCode: "CPS 510",
      kind: "lecture",
      size: 2,
      status: "proposed",
    });
    expect(JSON.stringify(res.body)).not.toContain("@torontomu.ca");
  });

  it("returns 403 to someone who isn't in the match", async () => {
    const { matchId } = await pairMatch();
    const eve = await student("eve");

    const res = await eve.get(`/matches/${matchId}`);

    expect(res.status).toBe(403);
    expect(res.body.match).toBeUndefined();
  });

  it("returns 401 when not logged in", async () => {
    const { matchId } = await pairMatch();

    expect((await request(app).get(`/matches/${matchId}`)).status).toBe(401);
  });

  it.each([
    ["an unknown match", "00000000-0000-0000-0000-000000000000"],
    ["a malformed id", "nope"],
  ])("returns 404 for %s", async (_name, id) => {
    const ann = await student("ann");

    expect((await ann.get(`/matches/${id}`)).status).toBe(404);
  });

  it("links the match from My requests", async () => {
    const { ann, matchId } = await pairMatch();

    const [mine] = (await ann.get("/requests/mine")).body.requests;

    expect(mine).toMatchObject({ status: "matched", matchId });
  });
});

describe("POST /matches/:id/accept", () => {
  it("records an acceptance and waits for the others", async () => {
    const { ann, matchId } = await pairMatch();

    const res = await answer(ann, matchId, true);

    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe("proposed");
    expect(res.body.match.members[0]).toMatchObject({ isMe: true, accepted: true });
    expect(res.body.match.members[1]).toMatchObject({ isMe: false, accepted: false });
  });

  it("becomes accepted once everyone accepts", async () => {
    const { ann, bob, matchId } = await pairMatch();

    await answer(ann, matchId, true).expect(200);
    const res = await answer(bob, matchId, true);

    expect(res.body.match.status).toBe("accepted");
  });

  it("is safe to accept twice", async () => {
    const { ann, matchId } = await pairMatch();

    await answer(ann, matchId, true).expect(200);
    const res = await answer(ann, matchId, true);

    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe("proposed");
  });

  it("ends the match on decline: the decliner's request is cancelled, the other reopens", async () => {
    const { bob, annRequest, bobRequest, matchId } = await pairMatch();

    const res = await answer(bob, matchId, false);

    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe("expired");
    expect(await statusOf(bobRequest)).toBe("cancelled");
    expect(await statusOf(annRequest)).toBe("open");
  });

  it("re-matches the others straight away after a decline", async () => {
    const { bob, annRequest, matchId } = await pairMatch();
    // Another student who also has 012 and wants 011 is waiting.
    await post(await student("cat"), "012", ["011"]);

    await answer(bob, matchId, false).expect(200);

    expect(await statusOf(annRequest)).toBe("matched");
    expect(await db.select().from(matches).where(eq(matches.status, "proposed"))).toHaveLength(1);
  });

  it("returns 403 to someone who isn't in the match, and changes nothing", async () => {
    const { annRequest, matchId } = await pairMatch();
    const eve = await student("eve");

    const res = await answer(eve, matchId, false);

    expect(res.status).toBe(403);
    expect(await matchStatus(matchId)).toBe("proposed");
    expect(await statusOf(annRequest)).toBe("matched");
  });

  it("returns 409 once the match has ended", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await answer(bob, matchId, false).expect(200);

    expect((await answer(ann, matchId, true)).status).toBe(409);
  });

  it("returns 409 after 24 hours, even before the sweep runs", async () => {
    const { ann, matchId } = await pairMatch();
    await db.update(matches).set({ expiresAt: new Date(Date.now() - 1000) });

    expect((await answer(ann, matchId, true)).status).toBe(409);
  });

  it("handles both students answering at the same moment", async () => {
    const { ann, bob, matchId } = await pairMatch();

    await Promise.all([answer(ann, matchId, true), answer(bob, matchId, true)]);

    expect(await matchStatus(matchId)).toBe("accepted");
  });

  it("rejects a body without accept", async () => {
    const { ann, matchId } = await pairMatch();

    const res = await ann.post(`/matches/${matchId}/accept`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Send accept: true or false");
  });
});

describe("24-hour expiry", () => {
  it("expires unanswered matches: acceptors reopen, non-responders expire", async () => {
    const { ann, annRequest, bobRequest, matchId } = await pairMatch();
    await answer(ann, matchId, true).expect(200);
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);

    const reopened = await expireDueMatches(tomorrow);

    expect(await matchStatus(matchId)).toBe("expired");
    expect(reopened).toEqual([annRequest]);
    expect(await statusOf(annRequest)).toBe("open");
    expect(await statusOf(bobRequest)).toBe("expired");
  });

  it("leaves matches alone before 24 hours", async () => {
    const { matchId } = await pairMatch();

    await expireDueMatches(new Date(Date.now() + 23 * 60 * 60 * 1000));

    expect(await matchStatus(matchId)).toBe("proposed");
  });

  it("never expires a match everyone accepted", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await answer(ann, matchId, true).expect(200);
    await answer(bob, matchId, true).expect(200);

    await runSweep(new Date(Date.now() + 48 * 60 * 60 * 1000));

    expect(await matchStatus(matchId)).toBe("accepted");
  });

  it("removes the match link from My requests once it expires", async () => {
    const { ann, matchId } = await pairMatch();
    await answer(ann, matchId, true).expect(200);

    await expireDueMatches(new Date(Date.now() + 25 * 60 * 60 * 1000));

    const [mine] = (await ann.get("/requests/mine")).body.requests;
    expect(mine).toMatchObject({ status: "open", matchId: null });
    expect(await db.select().from(matchMembers)).toHaveLength(2); // history is kept
  });
});
