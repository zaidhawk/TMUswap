import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { db, pool } from "../src/db/index.js";
import {
  courses,
  loginCodes,
  matches,
  messages,
  reports,
  sessions,
  swapRequests,
  users,
} from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { sendMessage } from "../src/chat/service.js";
import { deleteOldChats } from "../src/matching/engine.js";
import { emailsSentTo } from "../src/email.js";
import { resetDb } from "./db.js";
import { loginReady } from "./helpers.js";

const app = createApp();
let courseId: string;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);
  courseId = (await db.select().from(courses))[0]!.id;
});
afterAll(() => pool.end());

type Student = Awaited<ReturnType<typeof loginReady>>;

async function post(student: Student, have: string, wants: string[]) {
  const res = await student.agent
    .post("/requests")
    .send({ courseId, kind: "lecture", have, wants, noWaitlist: true })
    .expect(201);
  return res.body.request as { id: string; matchId: string | null };
}

// ann and bob matched; with `accepted`, the chat is open.
async function pairMatch({ accepted = true } = {}) {
  const ann = await loginReady(app, "ann@torontomu.ca");
  const bob = await loginReady(app, "bob@torontomu.ca");
  const annRequest = (await post(ann, "011", ["012"])).id;
  const b = await post(bob, "012", ["011"]);
  const matchId = b.matchId!;
  if (accepted) {
    await ann.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await bob.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
  }
  return { ann, bob, annRequest, bobRequest: b.id, matchId };
}

const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!;
const adminEmails = (subject: string) =>
  emailsSentTo(config.adminEmail).filter((e) => e.subject.includes(subject));

describe("POST /reports", () => {
  const reason = "Asked me to e-transfer $50 for the seat.";

  it("records the report and emails the admin with the reason and recent chat", async () => {
    const { ann, bobRequest, matchId } = await pairMatch();
    const before = adminEmails("Report").length;
    await sendMessage(await userRow(ann.userId), matchId, "Hi, ready at 3?");

    const res = await ann.agent.post("/reports").send({ matchId, memberId: bobRequest, reason });

    expect(res.status).toBe(201);
    const [saved] = await db.select().from(reports);
    expect(saved).toMatchObject({ reporterId: ann.userId, matchId, reason });
    const mails = adminEmails("Report");
    expect(mails).toHaveLength(before + 1);
    const mail = mails.at(-1)!;
    expect(mail.subject).toContain("CPS 510");
    expect(mail.text).toContain("bob@torontomu.ca");
    expect(mail.text).toContain(reason);
    expect(mail.text).toContain("Hi, ready at 3?");
  });

  it("works before the match is accepted too", async () => {
    const { ann, bobRequest, matchId } = await pairMatch({ accepted: false });

    expect((await ann.agent.post("/reports").send({ matchId, memberId: bobRequest, reason })).status).toBe(201);
  });

  it("rejects reporting yourself", async () => {
    const { ann, annRequest, matchId } = await pairMatch();

    const res = await ann.agent.post("/reports").send({ matchId, memberId: annRequest, reason });

    expect(res.status).toBe(400);
  });

  it("returns 403 to someone outside the match", async () => {
    const { bobRequest, matchId } = await pairMatch();
    const eve = await loginReady(app, "eve@torontomu.ca");

    const res = await eve.agent.post("/reports").send({ matchId, memberId: bobRequest, reason });

    expect(res.status).toBe(403);
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("returns 409 for a repeat report of the same person", async () => {
    const { ann, bobRequest, matchId } = await pairMatch();
    await ann.agent.post("/reports").send({ matchId, memberId: bobRequest, reason }).expect(201);

    expect((await ann.agent.post("/reports").send({ matchId, memberId: bobRequest, reason })).status).toBe(409);
  });

  it("needs a real reason", async () => {
    const { ann, bobRequest, matchId } = await pairMatch();

    const res = await ann.agent.post("/reports").send({ matchId, memberId: bobRequest, reason: "bad" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Tell us what happened (at least 10 characters)");
  });

  it("requires login", async () => {
    expect((await request(app).post("/reports").send({})).status).toBe(401);
  });
});

describe("money mentions in chat", () => {
  it.each([
    "I'll e-transfer you",
    "can you do $20?",
    "50 bucks and it's yours",
    "Paypal works",
    "I'm selling it",
  ])("emails the admin about: %s", async (body) => {
    const { ann, matchId } = await pairMatch();
    const before = adminEmails("Money mentioned").length;

    await sendMessage(await userRow(ann.userId), matchId, body);

    await expect.poll(() => adminEmails("Money mentioned").length).toBe(before + 1);
  });

  it.each(["Ready at 3pm?", "Section 012 is mine", "Thanks so much!"])("ignores: %s", async (body) => {
    const { ann, matchId } = await pairMatch();
    const before = adminEmails("Money mentioned").length;

    await sendMessage(await userRow(ann.userId), matchId, body);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(adminEmails("Money mentioned")).toHaveLength(before);
  });

  it("only emails once per chat", async () => {
    const { ann, bob, matchId } = await pairMatch();
    const before = adminEmails("Money mentioned").length;

    await sendMessage(await userRow(ann.userId), matchId, "e-transfer?");
    await expect.poll(() => adminEmails("Money mentioned").length).toBe(before + 1);
    await sendMessage(await userRow(bob.userId), matchId, "no money please");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(adminEmails("Money mentioned")).toHaveLength(before + 1);
  });
});

describe("DELETE /auth/me", () => {
  it("deletes the account and everything that belongs to it", async () => {
    const { ann, matchId } = await pairMatch();
    await sendMessage(await userRow(ann.userId), matchId, "bye");

    const res = await ann.agent.delete("/auth/me").send({ confirm: true });

    expect(res.status).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, ann.userId))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, ann.userId))).toHaveLength(0);
    expect(await db.select().from(swapRequests).where(eq(swapRequests.userId, ann.userId))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.senderId, ann.userId))).toHaveLength(0);
    expect(await db.select().from(loginCodes).where(eq(loginCodes.email, "ann@torontomu.ca"))).toHaveLength(0);
    expect((await ann.agent.get("/auth/me")).status).toBe(401);
  });

  it("ends their match and puts the other student back in the pool", async () => {
    const { ann, bob, bobRequest, matchId } = await pairMatch();

    await ann.agent.delete("/auth/me").send({ confirm: true }).expect(200);

    expect((await db.select().from(matches).where(eq(matches.id, matchId)))[0]!.status).toBe("expired");
    expect((await db.select().from(swapRequests).where(eq(swapRequests.id, bobRequest)))[0]!.status).toBe("open");
    // bob can still open the ended match without errors.
    const view = await bob.agent.get(`/matches/${matchId}`);
    expect(view.status).toBe(200);
    expect(view.body.match.members).toHaveLength(1);
  });

  it("requires an explicit confirmation", async () => {
    const { ann } = await pairMatch();

    const res = await ann.agent.delete("/auth/me").send({});

    expect(res.status).toBe(400);
    expect(await db.select().from(users).where(eq(users.id, ann.userId))).toHaveLength(1);
  });

  it("lets the same email sign up again as a fresh account", async () => {
    const { ann } = await pairMatch();
    await ann.agent.delete("/auth/me").send({ confirm: true }).expect(200);

    const again = await loginReady(app, "ann@torontomu.ca");

    expect(again.userId).not.toBe(ann.userId);
  });
});

describe("30-day chat cleanup", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("deletes chats 30 days after the match closes, and keeps newer ones", async () => {
    const { ann, matchId } = await pairMatch();
    await sendMessage(await userRow(ann.userId), matchId, "thanks!");
    await ann.agent.post(`/matches/${matchId}/outcome`).send({ outcome: "completed" }).expect(200);

    expect(await deleteOldChats(new Date(Date.now() + 29 * DAY))).toBe(0);
    expect(await db.select().from(messages)).toHaveLength(1);

    expect(await deleteOldChats(new Date(Date.now() + 31 * DAY))).toBe(1);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("never deletes the chat of a match that is still going", async () => {
    const { ann, matchId } = await pairMatch();
    await sendMessage(await userRow(ann.userId), matchId, "still planning");

    expect(await deleteOldChats(new Date(Date.now() + 365 * DAY))).toBe(0);
  });

  it("records when expired and declined matches close", async () => {
    const { bob, matchId } = await pairMatch({ accepted: false });

    await bob.agent.post(`/matches/${matchId}/accept`).send({ accept: false }).expect(200);

    const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(match!.closedAt).not.toBeNull();
  });
});
