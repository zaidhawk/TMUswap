import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, sections, swapRequests } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { resetDb } from "./db.js";
import { login, loginReady } from "./helpers.js";

const app = createApp();
let courseId: string;
let otherCourseId: string;

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [
    { code: "CPS 510", title: "Database Systems I" },
    { code: "CPS 590", title: "Operating Systems I" },
  ]);
  const rows = await db.select().from(courses);
  courseId = rows.find((c) => c.code === "CPS 510")!.id;
  otherCourseId = rows.find((c) => c.code === "CPS 590")!.id;
});
afterAll(() => pool.end());

const validBody = () => ({
  courseId,
  kind: "lecture",
  have: "011",
  wants: ["012", "015"],
  noWaitlist: true,
});

describe("POST /requests", () => {
  it("creates a request and returns it", async () => {
    const { agent } = await loginReady(app);

    const res = await agent.post("/requests").send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({
      courseCode: "CPS 510",
      kind: "lecture",
      have: "011",
      wants: ["012", "015"],
      status: "open",
    });
  });

  it("creates sections the first time anyone mentions them, and reuses them after", async () => {
    const a = await loginReady(app, "a@torontomu.ca");
    const b = await loginReady(app, "b@torontomu.ca");

    await a.agent.post("/requests").send({ ...validBody(), have: "011", wants: ["012"] }).expect(201);
    await b.agent.post("/requests").send({ ...validBody(), have: "012", wants: ["011"] }).expect(201);

    // Both students point at the same two section rows, which is what lets them match.
    expect(await db.select().from(sections)).toHaveLength(2);
  });

  it("pads section numbers so 11 and 011 are the same section", async () => {
    const { agent } = await loginReady(app);

    const res = await agent.post("/requests").send({ ...validBody(), have: "11", wants: ["12", " 015 "] });

    expect(res.body.request.have).toBe("011");
    expect(res.body.request.wants).toEqual(["012", "015"]);
  });

  it("ignores repeated wants", async () => {
    const { agent } = await loginReady(app);

    const res = await agent.post("/requests").send({ ...validBody(), wants: ["012", "12", "012"] });

    expect(res.body.request.wants).toEqual(["012"]);
  });

  it.each([
    ["wanting the section you have", { wants: ["011"] }, "You can't ask for the section you already have"],
    ["no wants", { wants: [] }, "Pick at least one section you'd accept"],
    ["more than 10 wants", { wants: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "12"] }, "You can list at most 10 sections"],
    ["a non-numeric section", { have: "A1" }, "Section numbers are 1–3 digits, like 011"],
    ["a 4-digit section", { wants: ["0123"] }, "Section numbers are 1–3 digits, like 011"],
    ["an unknown kind", { kind: "seminar" }, "Pick lecture, lab or tutorial"],
    ["not confirming the wait list", { noWaitlist: false }, "Confirm your sections have no wait list"],
    ["a missing wait-list confirmation", { noWaitlist: undefined }, "Confirm your sections have no wait list"],
    ["a malformed course id", { courseId: "nope" }, "Pick a course"],
  ])("rejects %s", async (_name, change, message) => {
    const { agent } = await loginReady(app);

    const res = await agent.post("/requests").send({ ...validBody(), ...change });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await db.select().from(swapRequests)).toHaveLength(0);
  });

  it("rejects a course that doesn't exist", async () => {
    const { agent } = await loginReady(app);

    const res = await agent
      .post("/requests")
      .send({ ...validBody(), courseId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("That course isn't available");
  });

  it("rejects a second active request for the same seat with 409", async () => {
    const { agent } = await loginReady(app);
    await agent.post("/requests").send(validBody()).expect(201);

    const res = await agent.post("/requests").send({ ...validBody(), wants: ["020"] });

    expect(res.status).toBe(409);
  });

  it("allows requests for different courses and kinds at the same time", async () => {
    const { agent } = await loginReady(app);

    await agent.post("/requests").send(validBody()).expect(201);
    await agent.post("/requests").send({ ...validBody(), kind: "lab", have: "021", wants: ["022"] }).expect(201);
    await agent.post("/requests").send({ ...validBody(), courseId: otherCourseId }).expect(201);
  });

  it("allows a new request for a seat once the old one is cancelled", async () => {
    const { agent } = await loginReady(app);
    const first = await agent.post("/requests").send(validBody()).expect(201);
    await agent.patch(`/requests/${first.body.request.id}`).send({ status: "cancelled" }).expect(200);

    await agent.post("/requests").send(validBody()).expect(201);
  });

  it("allows 10 requests a day, then returns 429", async () => {
    const { agent } = await loginReady(app);
    for (let i = 0; i < 10; i++) {
      const created = await agent
        .post("/requests")
        .send({ ...validBody(), have: String(100 + i), wants: ["999"] })
        .expect(201);
      // Cancel each one so the one-per-seat rule doesn't get in the way.
      await agent.patch(`/requests/${created.body.request.id}`).send({ status: "cancelled" });
    }

    const res = await agent.post("/requests").send(validBody());

    expect(res.status).toBe(429);
  });

  it("requires login", async () => {
    expect((await request(app).post("/requests").send(validBody())).status).toBe(401);
  });

  it("requires a display name", async () => {
    const { agent } = await login(app);

    const res = await agent.post("/requests").send(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Pick a display name first");
  });
});

describe("GET /requests/mine", () => {
  it("returns only your own requests, newest first", async () => {
    const me = await loginReady(app, "me@torontomu.ca");
    const other = await loginReady(app, "other@torontomu.ca");
    await me.agent.post("/requests").send({ ...validBody(), have: "011" }).expect(201);
    await me.agent.post("/requests").send({ ...validBody(), courseId: otherCourseId, have: "031", wants: ["032"] }).expect(201);
    await other.agent.post("/requests").send({ ...validBody(), have: "012", wants: ["011"] }).expect(201);

    const res = await me.agent.get("/requests/mine");

    expect(res.status).toBe(200);
    expect(res.body.requests.map((r: { have: string }) => r.have)).toEqual(["031", "011"]);
  });

  it("requires login", async () => {
    expect((await request(app).get("/requests/mine")).status).toBe(401);
  });
});

describe("PATCH /requests/:id", () => {
  async function createRequest(agent: Awaited<ReturnType<typeof loginReady>>["agent"]) {
    return (await agent.post("/requests").send(validBody()).expect(201)).body.request.id as string;
  }

  it("replaces the wanted sections", async () => {
    const { agent } = await loginReady(app);
    const id = await createRequest(agent);

    const res = await agent.patch(`/requests/${id}`).send({ wants: ["020", "21"] });

    expect(res.status).toBe(200);
    expect(res.body.request.wants).toEqual(["020", "021"]);
  });

  it("cancels the request", async () => {
    const { agent } = await loginReady(app);
    const id = await createRequest(agent);

    const res = await agent.patch(`/requests/${id}`).send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("cancelled");
  });

  it("returns 404 for someone else's request and leaves it alone", async () => {
    const owner = await loginReady(app, "owner@torontomu.ca");
    const intruder = await loginReady(app, "intruder@torontomu.ca");
    const id = await createRequest(owner.agent);

    const cancel = await intruder.agent.patch(`/requests/${id}`).send({ status: "cancelled" });
    const edit = await intruder.agent.patch(`/requests/${id}`).send({ wants: ["099"] });

    expect(cancel.status).toBe(404);
    expect(edit.status).toBe(404);
    const [mine] = (await owner.agent.get("/requests/mine")).body.requests;
    expect(mine).toMatchObject({ status: "open", wants: ["012", "015"] });
  });

  it("can't change a request that isn't open", async () => {
    const { agent } = await loginReady(app);
    const id = await createRequest(agent);
    await agent.patch(`/requests/${id}`).send({ status: "cancelled" }).expect(200);

    const res = await agent.patch(`/requests/${id}`).send({ wants: ["020"] });

    expect(res.status).toBe(409);
  });

  it("can't want the section you have", async () => {
    const { agent } = await loginReady(app);
    const id = await createRequest(agent);

    const res = await agent.patch(`/requests/${id}`).send({ wants: ["11"] });

    expect(res.status).toBe(400);
  });

  it.each([
    ["both wants and status", { wants: ["020"], status: "cancelled" }],
    ["neither", {}],
    ["a status other than cancelled", { status: "completed" }],
  ])("rejects a body with %s", async (_name, body) => {
    const { agent } = await loginReady(app);
    const id = await createRequest(agent);

    expect((await agent.patch(`/requests/${id}`).send(body)).status).toBe(400);
  });

  it("returns 404 for a malformed id", async () => {
    const { agent } = await loginReady(app);

    expect((await agent.patch("/requests/nope").send({ status: "cancelled" })).status).toBe(404);
  });
});
