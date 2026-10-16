import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pool } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import { courses, messages, matches, sections, swapRequests, users } from "../src/db/schema.js";
import { resetDb } from "./db.js";

type Db = NodePgDatabase<typeof schema>;

// Runs each test inside a transaction that is always rolled back, so tests leave no data behind.
async function inRollback(fn: (db: Db) => Promise<void>) {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    await fn(drizzle(client, { schema }));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

// Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = { cause: { code: "23505" } };
const CHECK_VIOLATION = { cause: { code: "23514" } };

async function seedSection(db: Db) {
  const [user] = await db
    .insert(users)
    .values({ email: "student@torontomu.ca", displayName: "Student" })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ code: "CPS 510", term: "2027W", title: "Database Systems I" })
    .returning();
  const [section] = await db
    .insert(sections)
    .values({ courseId: course!.id, kind: "lecture", label: "011" })
    .returning();
  return { user: user!, course: course!, section: section! };
}

beforeAll(resetDb);
afterAll(() => pool.end());

describe("users", () => {
  it("rejects emails outside @torontomu.ca", () =>
    inRollback(async (db) => {
      await expect(
        db.insert(users).values({ email: "someone@gmail.com", displayName: "X" }),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    }));

  it("rejects duplicate emails", () =>
    inRollback(async (db) => {
      await db.insert(users).values({ email: "a@torontomu.ca", displayName: "A" });
      await expect(
        db.insert(users).values({ email: "a@torontomu.ca", displayName: "B" }),
      ).rejects.toMatchObject(UNIQUE_VIOLATION);
    }));
});

describe("sections", () => {
  it("rejects the same section twice in a course", () =>
    inRollback(async (db) => {
      const { course } = await seedSection(db);
      await expect(
        db.insert(sections).values({ courseId: course.id, kind: "lecture", label: "011" }),
      ).rejects.toMatchObject(UNIQUE_VIOLATION);
    }));
});

describe("swap_requests", () => {
  it("rejects a second active request for the same seat", () =>
    inRollback(async (db) => {
      const { user, section } = await seedSection(db);
      await db.insert(swapRequests).values({ userId: user.id, haveSectionId: section.id });
      await expect(
        db.insert(swapRequests).values({ userId: user.id, haveSectionId: section.id }),
      ).rejects.toMatchObject(UNIQUE_VIOLATION);
    }));

  it("allows a new request once the old one is cancelled", () =>
    inRollback(async (db) => {
      const { user, section } = await seedSection(db);
      await db
        .insert(swapRequests)
        .values({ userId: user.id, haveSectionId: section.id, status: "cancelled" });
      await db.insert(swapRequests).values({ userId: user.id, haveSectionId: section.id });
    }));
});

describe("matches", () => {
  it("only allows sizes 2 and 3", () =>
    inRollback(async (db) => {
      await expect(
        db.insert(matches).values({ size: 4, expiresAt: new Date() }),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    }));
});

describe("messages", () => {
  it("rejects bodies over 1,000 characters", () =>
    inRollback(async (db) => {
      const { user } = await seedSection(db);
      const [match] = await db.insert(matches).values({ size: 2, expiresAt: new Date() }).returning();
      await expect(
        db.insert(messages).values({ matchId: match!.id, senderId: user.id, body: "x".repeat(1001) }),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    }));
});
