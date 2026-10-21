import { Router } from "express";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { courses, sections } from "../db/schema.js";

export const coursesRouter = Router();

// Escapes the LIKE wildcards % and _ so a search for "100%" is taken literally.
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

// GET /courses?q=cps510 — matches the code (ignoring spaces) or the title.
coursesRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const compactQ = likeEscape(q.replace(/\s+/g, ""));

  const rows = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courses)
    .where(
      and(
        eq(courses.term, config.currentTerm),
        q
          ? or(
              sql`replace(${courses.code}, ' ', '') ILIKE ${`%${compactQ}%`}`,
              ilike(courses.title, `%${likeEscape(q)}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(courses.code))
    .limit(20);

  res.json({ courses: rows });
});

// GET /courses/:id/sections — the sections students have posted for this course so far.
coursesRouter.get("/:id/sections", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const [course] = await db.select().from(courses).where(eq(courses.id, id.data));
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const rows = await db
    .select({ id: sections.id, kind: sections.kind, label: sections.label })
    .from(sections)
    .where(eq(sections.courseId, course.id))
    .orderBy(asc(sections.kind), asc(sections.label));

  res.json({ course: { id: course.id, code: course.code, title: course.title }, sections: rows });
});
