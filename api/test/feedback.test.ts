import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { db, pool } from "../src/db/index.js";
import { feedback } from "../src/db/schema.js";
import { emailsSentTo } from "../src/email.js";
import { MAX_FEEDBACK_PER_DAY } from "../src/feedback/routes.js";
import { resetDb } from "./db.js";
import { login, loginReady } from "./helpers.js";

const app = createApp();

beforeEach(resetDb);
afterAll(() => pool.end());

const feedbackEmails = () => emailsSentTo(config.adminEmail).filter((e) => e.subject.includes("Feedback from"));

describe("POST /feedback", () => {
  it("saves it and emails the admin who sent it, from which page and browser", async () => {
    const { agent } = await loginReady(app, "ann@torontomu.ca");
    const before = feedbackEmails().length;

    await agent
      .post("/feedback")
      .set("User-Agent", "TestPhone/1.0")
      .send({ message: "The Start button did nothing on my phone", page: "/matches/abc" })
      .expect(201);

    const saved = await db.select().from(feedback);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ message: "The Start button did nothing on my phone", page: "/matches/abc" });

    const sent = feedbackEmails().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("[TMU Swap admin] Feedback from Student ann");
    expect(sent[0]!.text).toContain("From: Student ann (ann@torontomu.ca)");
    expect(sent[0]!.text).toContain("Page: /matches/abc");
    expect(sent[0]!.text).toContain("Browser: TestPhone/1.0");
    expect(sent[0]!.text).toContain("The Start button did nothing on my phone");
  });

  it("works before a display name is picked, so new users can say what's stuck", async () => {
    const { agent } = await login(app, "new@torontomu.ca");
    const before = feedbackEmails().length;

    await agent.post("/feedback").send({ message: "I don't get what a display name is for" }).expect(201);

    const sent = feedbackEmails().slice(before);
    expect(sent[0]!.subject).toBe("[TMU Swap admin] Feedback from new@torontomu.ca");
    expect(sent[0]!.text).toContain("From: (no display name yet) (new@torontomu.ca)");
    expect(sent[0]!.text).toContain("Page: unknown");
  });

  it("needs a login", async () => {
    await request(app).post("/feedback").send({ message: "Hello from nobody at all" }).expect(401);
    expect(await db.select().from(feedback)).toHaveLength(0);
  });

  it("rejects a message that's too short or too long", async () => {
    const { agent } = await loginReady(app, "ann@torontomu.ca");

    const short = await agent.post("/feedback").send({ message: "   broken " }).expect(400);
    expect(short.body.error).toBe("Tell us a bit more (at least 10 characters)");
    await agent.post("/feedback").send({ message: "x".repeat(2001) }).expect(400);
    await agent.post("/feedback").send({}).expect(400);

    expect(await db.select().from(feedback)).toHaveLength(0);
  });

  it(`allows ${MAX_FEEDBACK_PER_DAY} a day per person`, async () => {
    const ann = await loginReady(app, "ann@torontomu.ca");
    const bob = await loginReady(app, "bob@torontomu.ca");
    for (let i = 0; i < MAX_FEEDBACK_PER_DAY; i++) {
      await ann.agent.post("/feedback").send({ message: `Idea number ${i} for the app` }).expect(201);
    }

    const res = await ann.agent.post("/feedback").send({ message: "One more idea for the app" }).expect(429);
    expect(res.body.error).toMatch(/a lot of feedback today/);
    // Someone else isn't affected.
    await bob.agent.post("/feedback").send({ message: "My first idea for the app" }).expect(201);
  });

  it("is deleted along with the account", async () => {
    const { agent } = await loginReady(app, "ann@torontomu.ca");
    await agent.post("/feedback").send({ message: "Please add engineering courses" }).expect(201);

    await agent.delete("/auth/me").send({ confirm: true }).expect(200);

    expect(await db.select().from(feedback)).toHaveLength(0);
  });
});
