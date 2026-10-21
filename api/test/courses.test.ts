import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, sections } from "../src/db/schema.js";
import { parseCoursesCsv, seedCourses, seedCoursesFromFile } from "../src/courses/seed.js";
import { resetDb } from "./db.js";

const app = createApp();

beforeEach(resetDb);
afterAll(() => pool.end());

describe("parseCoursesCsv", () => {
  it("reads codes and titles, including quoted titles with commas", () => {
    const rows = parseCoursesCsv(
      'code,title\nCPS 510,Database Systems I\nCPS 393,"Introduction to UNIX, C and C++"\n',
    );

    expect(rows).toEqual([
      { code: "CPS 510", title: "Database Systems I" },
      { code: "CPS 393", title: "Introduction to UNIX, C and C++" },
    ]);
  });

  it("tidies the course code", () => {
    expect(parseCoursesCsv("code,title\ncps   510,Databases")).toEqual([
      { code: "CPS 510", title: "Databases" },
    ]);
  });

  it.each([
    ["a wrong header", "name,title\nCPS 510,Databases"],
    ["a bad code", "code,title\nCPS510,Databases"],
    ["a missing title", "code,title\nCPS 510,"],
  ])("rejects %s", (_name, csv) => {
    expect(() => parseCoursesCsv(csv)).toThrow();
  });
});

describe("seeding", () => {
  it("can run twice without making duplicates, and updates titles", async () => {
    await seedCourses("2027W", [{ code: "CPS 510", title: "Old title" }]);
    await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);

    const rows = await db.select().from(courses);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Database Systems I");
  });

  it("loads the real course file", async () => {
    const count = await seedCoursesFromFile("2027W", "data/courses-2027W.csv");

    expect(count).toBeGreaterThan(10);
    const rows = await db.select().from(courses);
    expect(rows).toHaveLength(count);
    // Computer science and engineering students are both covered.
    const codes = rows.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["CPS 109", "MEC 222", "MTH 140", "CEN 100"]));
  });
});

describe("GET /courses", () => {
  beforeEach(async () => {
    await seedCourses("2027W", [
      { code: "CPS 510", title: "Database Systems I" },
      { code: "CPS 590", title: "Operating Systems I" },
      { code: "MTH 110", title: "Discrete Mathematics I" },
    ]);
    await seedCourses("2026F", [{ code: "CPS 999", title: "Last Term's Course" }]);
  });

  const search = async (q: string) =>
    (await request(app).get("/courses").query({ q })).body.courses.map((c: { code: string }) => c.code);

  it.each([
    ["the exact code", "CPS 510", ["CPS 510"]],
    ["the code without a space", "cps510", ["CPS 510"]],
    ["just the number", "510", ["CPS 510"]],
    ["part of the title", "systems", ["CPS 510", "CPS 590"]],
    ["a title in any case", "DISCRETE", ["MTH 110"]],
  ])("finds courses by %s", async (_name, q, expected) => {
    expect(await search(q)).toEqual(expected);
  });

  it("lists this term's courses when the search is empty", async () => {
    expect(await search("")).toEqual(["CPS 510", "CPS 590", "MTH 110"]);
  });

  it("never returns courses from other terms", async () => {
    expect(await search("999")).toEqual([]);
  });

  it("treats % and _ as plain characters", async () => {
    expect(await search("%")).toEqual([]);
    expect(await search("_")).toEqual([]);
  });

  it("doesn't need a login", async () => {
    expect((await request(app).get("/courses")).status).toBe(200);
  });
});

describe("GET /courses/:id/sections", () => {
  it("lists the course's sections", async () => {
    await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);
    const [course] = await db.select().from(courses);
    await db.insert(sections).values([
      { courseId: course!.id, kind: "lecture", label: "011" },
      { courseId: course!.id, kind: "lab", label: "021" },
    ]);

    const res = await request(app).get(`/courses/${course!.id}/sections`);

    expect(res.status).toBe(200);
    expect(res.body.course.code).toBe("CPS 510");
    expect(res.body.sections.map((s: { label: string }) => s.label).sort()).toEqual(["011", "021"]);
  });

  it.each([
    ["an unknown course", "00000000-0000-0000-0000-000000000000"],
    ["a malformed id", "not-a-uuid"],
  ])("returns 404 for %s", async (_name, id) => {
    expect((await request(app).get(`/courses/${id}/sections`)).status).toBe(404);
  });
});
