import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, matches, swapOffers, swapRequests, users } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { emailsSentTo } from "../src/email.js";
import { loadStats } from "../src/admin/routes.js";
import { MAX_OFFERS_PER_DAY } from "../src/board/routes.js";
import { resetDb, waitForLockWaiters } from "./db.js";
import { login, loginReady } from "./helpers.js";

const app = createApp();
let cps109: string;
let mec309: string;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [
    { code: "CPS 109", title: "Computer Science I" },
    { code: "MEC 309", title: "Basic Thermodynamics" },
  ]);
  const rows = await db.select().from(courses);
  cps109 = rows.find((c) => c.code === "CPS 109")!.id;
  mec309 = rows.find((c) => c.code === "MEC 309")!.id;
});
afterAll(() => pool.end());

type Agent = Awaited<ReturnType<typeof loginReady>>["agent"];
type BoardItem = {
  id: string;
  courseCode: string;
  kind: string;
  have: string;
  wants: string[];
  isMine: boolean;
  myOffer: "pending" | "declined" | null;
};

const student = (name: string) => loginReady(app, `${name}@torontomu.ca`).then((s) => s.agent);

async function post(agent: Agent, have: string, wants: string[], courseId = cps109, kind = "lecture") {
  const res = await agent.post("/requests").send({ courseId, kind, have, wants, noWaitlist: true }).expect(201);
  return res.body.request as { id: string; status: string; matchId: string | null };
}

async function board(agent: Agent, q = "") {
  const res = await agent.get(`/board?q=${encodeURIComponent(q)}`).expect(200);
  return res.body.requests as BoardItem[];
}

const offer = (agent: Agent, requestId: string, have: string) =>
  agent.post(`/board/${requestId}/offers`).send({ have, noWaitlist: true });

async function offers(agent: Agent) {
  return (await agent.get("/offers").expect(200)).body as {
    received: { id: string; courseCode: string; kind: string; yourSection: string; theirSection: string }[];
    sent: { id: string; status: string; yourSection: string; theirSection: string; requestOpen: boolean }[];
  };
}

const requestRow = async (id: string) => (await db.select().from(swapRequests).where(eq(swapRequests.id, id)))[0]!;
const offerRow = async (id: string) => (await db.select().from(swapOffers).where(eq(swapOffers.id, id)))[0]!;

describe("GET /board", () => {
  it("needs a login", async () => {
    await request(app).get("/board").expect(401);
  });

  it("lists open requests newest first, with the poster's display name but never their email", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, "011", ["012", "15"]);
    await post(bob, "021", ["022"], mec309, "lab");

    const res = await ann.get("/board").expect(200);
    expect(res.body.requests).toMatchObject([
      {
        courseCode: "MEC 309",
        courseTitle: "Basic Thermodynamics",
        kind: "lab",
        have: "021",
        wants: ["022"],
        postedBy: "Student bob",
      },
      { courseCode: "CPS 109", kind: "lecture", have: "011", wants: ["012", "015"], postedBy: "Student ann" },
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/@torontomu|userId/);
  });

  it("marks your own requests so you can't offer on them", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(ann, "011", ["012"]);

    expect((await board(ann))[0]).toMatchObject({ isMine: true, myOffer: null });
    expect((await board(bob))[0]).toMatchObject({ isMine: false, myOffer: null });
  });

  it("leaves out cancelled and matched requests", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const cat = await student("cat");
    const cancelled = await post(ann, "011", ["012"]);
    await ann.patch(`/requests/${cancelled.id}`).send({ status: "cancelled" }).expect(200);
    await post(bob, "031", ["032"]);
    await post(cat, "032", ["031"]); // matches bob's

    expect(await board(ann)).toEqual([]);
  });

  it("searches by course code (any spacing or case) or title", async () => {
    const ann = await student("ann");
    await post(ann, "011", ["012"]);
    await post(ann, "021", ["022"], mec309);

    expect((await board(ann, "cps109")).map((r) => r.courseCode)).toEqual(["CPS 109"]);
    expect((await board(ann, "MEC 3")).map((r) => r.courseCode)).toEqual(["MEC 309"]);
    expect((await board(ann, "thermo")).map((r) => r.courseCode)).toEqual(["MEC 309"]);
    expect(await board(ann, "chemistry")).toEqual([]);
  });

  it("hides requests from banned students", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    await post(bob, "011", ["012"]);
    await db.update(users).set({ isBanned: true }).where(eq(users.email, "bob@torontomu.ca"));

    expect(await board(ann)).toEqual([]);
  });
});

describe("making an offer", () => {
  it("reaches the poster, live and by email, and shows as pending for the sender", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);

    const res = await offer(bob, posting.id, "13").expect(201);

    expect((await offers(ann)).received).toMatchObject([
      { id: res.body.offer.id, courseCode: "CPS 109", kind: "lecture", yourSection: "011", theirSection: "013" },
    ]);
    expect((await offers(bob)).sent).toMatchObject([
      { status: "pending", yourSection: "013", theirSection: "011", requestOpen: true },
    ]);
    expect((await board(bob))[0]!.myOffer).toBe("pending");
    expect(emailsSentTo("ann@torontomu.ca").at(-1)!.subject).toBe("Someone offered you a swap for CPS 109");
    // Nothing changes for the poster until they answer.
    expect((await requestRow(posting.id)).status).toBe("open");
  });

  it("is refused when it makes no sense", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);

    await offer(ann, posting.id, "013").expect(400); // your own request
    expect((await offer(bob, posting.id, "11").expect(400)).body.error).toBe("They already have section 011");
    await offer(bob, posting.id, "abc").expect(400);
    await bob.post(`/board/${posting.id}/offers`).send({ have: "013" }).expect(400); // no wait-list confirmation
    await offer(bob, "00000000-0000-4000-8000-000000000000", "013").expect(404);
    await offer(bob, "not-an-id", "013").expect(404);

    await ann.patch(`/requests/${posting.id}`).send({ status: "cancelled" }).expect(200);
    expect((await offer(bob, posting.id, "013").expect(409)).body.error).toBe("This request isn't open anymore");
    expect(await db.select().from(swapOffers)).toHaveLength(0);
  });

  it("needs a display name first", async () => {
    const ann = await student("ann");
    const posting = await post(ann, "011", ["012"]);
    const { agent: newbie } = await login(app, "new@torontomu.ca");

    await offer(newbie, posting.id, "013").expect(403);
  });

  it("allows one waiting offer per request", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);

    await offer(bob, posting.id, "013").expect(201);
    const again = await offer(bob, posting.id, "014").expect(409);
    expect(again.body.error).toBe("You've already sent an offer for this request");
  });

  it(`allows ${MAX_OFFERS_PER_DAY} a day`, async () => {
    const bob = await student("bob");
    for (let i = 0; i < MAX_OFFERS_PER_DAY; i++) {
      const poster = await student(`poster${i}`);
      const posting = await post(poster, "011", ["012"]);
      await offer(bob, posting.id, "013").expect(201);
    }
    const last = await student("last");
    const posting = await post(last, "011", ["012"]);

    await offer(bob, posting.id, "013").expect(429);
  });
});

describe("accepting an offer", () => {
  it("matches both students straight into an accepted swap with the chat open", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;

    const { matchId } = (await ann.post(`/offers/${sent.id}/accept`).expect(200)).body;

    for (const agent of [ann, bob]) {
      const view = (await agent.get(`/matches/${matchId}`).expect(200)).body.match;
      expect(view).toMatchObject({ size: 2, status: "accepted", courseCode: "CPS 109" });
      expect(view.members.every((m: { accepted: boolean }) => m.accepted)).toBe(true);
      await agent.get(`/matches/${matchId}/messages`).expect(200);
    }
    const annView = (await ann.get(`/matches/${matchId}`).expect(200)).body.match;
    expect(annView.members[0]).toMatchObject({ isMe: true, gives: "011", gets: "013", goesFirst: true });

    // Bob gets a request for the section he offered, already matched.
    const bobRequests = (await bob.get("/requests/mine").expect(200)).body.requests;
    expect(bobRequests).toMatchObject([{ have: "013", wants: ["011"], status: "matched", matchId }]);
    expect((await requestRow(posting.id)).status).toBe("matched");
    expect((await offerRow(sent.id)).status).toBe("accepted");
    expect(emailsSentTo("bob@torontomu.ca").at(-1)!.subject).toBe("Your CPS 109 swap offer was accepted");
    expect(await board(bob)).toEqual([]);
  });

  it("uses the sender's own open request for that section, if they have one", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);
    const bobsOwn = await post(bob, "013", ["015"]);
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;

    await ann.post(`/offers/${sent.id}/accept`).expect(200);

    const bobRequests = (await bob.get("/requests/mine").expect(200)).body.requests;
    expect(bobRequests).toMatchObject([{ id: bobsOwn.id, status: "matched", wants: ["011", "015"] }]);
  });

  it("fails if the sender's section is already in another swap", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const dan = await student("dan");
    const posting = await post(ann, "011", ["012"]);
    await post(bob, "013", ["015"]);
    await post(dan, "015", ["013"]); // matches bob's 013
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;

    const res = await ann.post(`/offers/${sent.id}/accept`).expect(409);

    expect(res.body.error).toBe("They're already in another swap with that section");
    expect((await requestRow(posting.id)).status).toBe("open");
    expect((await offerRow(sent.id)).status).toBe("pending");
  });

  it("fails once the request was matched some other way, and the offer drops off the list", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const cat = await student("cat");
    const posting = await post(ann, "011", ["012"]);
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;
    await post(cat, "012", ["011"]); // automatic match with ann

    await ann.post(`/offers/${sent.id}/accept`).expect(409);
    expect((await offers(ann)).received).toEqual([]);
    expect((await offers(bob)).sent[0]).toMatchObject({ status: "pending", requestOpen: false });
  });

  it("makes only one match when two offers are accepted at the same moment", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const cat = await student("cat");
    const posting = await post(ann, "011", ["012"]);
    const fromBob = (await offer(bob, posting.id, "013").expect(201)).body.offer;
    const fromCat = (await offer(cat, posting.id, "014").expect(201)).body.offer;

    // Hold ann's request from another connection so both accepts queue up and then run together.
    // Left to chance, the first usually finishes before the second starts.
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM swap_requests WHERE id = $1 FOR UPDATE", [posting.id]);
    const racing = Promise.all([ann.post(`/offers/${fromBob.id}/accept`), ann.post(`/offers/${fromCat.id}/accept`)]);
    await waitForLockWaiters(2);
    await blocker.query("COMMIT");
    blocker.release();
    const results = await racing;

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.select().from(matches)).toHaveLength(1);
  });
});

describe("declining and withdrawing", () => {
  it("declining keeps your request open and stops them offering again", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;

    await ann.post(`/offers/${sent.id}/decline`).expect(200);

    expect((await requestRow(posting.id)).status).toBe("open");
    expect((await offers(ann)).received).toEqual([]);
    expect((await offers(bob)).sent[0]).toMatchObject({ status: "declined" });
    expect((await board(bob))[0]!.myOffer).toBe("declined");
    const again = await offer(bob, posting.id, "014").expect(409);
    expect(again.body.error).toBe("They declined your offer for this request");
  });

  it("the sender can withdraw a waiting offer, and then it can't be accepted", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;

    await bob.post(`/offers/${sent.id}/withdraw`).expect(200);

    expect((await offers(ann)).received).toEqual([]);
    const res = await ann.post(`/offers/${sent.id}/accept`).expect(409);
    expect(res.body.error).toBe("This offer was already withdrawn");
  });

  it("only the poster can answer, and only the sender can withdraw", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const eve = await student("eve");
    const posting = await post(ann, "011", ["012"]);
    const { offer: sent } = (await offer(bob, posting.id, "013").expect(201)).body;

    await bob.post(`/offers/${sent.id}/accept`).expect(404);
    await eve.post(`/offers/${sent.id}/accept`).expect(404);
    await eve.post(`/offers/${sent.id}/decline`).expect(404);
    await ann.post(`/offers/${sent.id}/withdraw`).expect(404);
    await eve.post(`/offers/${sent.id}/withdraw`).expect(404);
    await ann.post("/offers/not-an-id/accept").expect(404);
    expect((await offerRow(sent.id)).status).toBe("pending");
  });

  it("an offer disappears when the sender deletes their account", async () => {
    const ann = await student("ann");
    const bob = await student("bob");
    const posting = await post(ann, "011", ["012"]);
    await offer(bob, posting.id, "013").expect(201);

    await bob.delete("/auth/me").send({ confirm: true }).expect(200);

    expect((await offers(ann)).received).toEqual([]);
    expect(await db.select().from(swapOffers)).toHaveLength(0);
  });
});

it("counts offers on the stats page", async () => {
  const ann = await student("ann");
  const bob = await student("bob");
  const cat = await student("cat");
  const posting = await post(ann, "011", ["012"]);
  const fromBob = (await offer(bob, posting.id, "013").expect(201)).body.offer;
  await offer(cat, posting.id, "014").expect(201);
  await ann.post(`/offers/${fromBob.id}/accept`).expect(200);

  expect((await loadStats()).totals).toMatchObject({
    offersSent: 2,
    offersAccepted: 1,
    matches: 1,
    acceptedMatches: 1,
    requestsPosted: 2, // ann's, and the one created for bob's section
  });
});
