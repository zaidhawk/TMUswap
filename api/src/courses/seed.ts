import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { courses } from "../db/schema.js";

export type CourseRow = { code: string; title: string };

// Parses "code,title" lines. Titles may contain commas if wrapped in double quotes.
export function parseCoursesCsv(text: string): CourseRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const [header, ...rows] = lines;
  if (header?.trim() !== "code,title") {
    throw new Error(`Expected header "code,title", got "${header}"`);
  }

  return rows.map((line, i) => {
    const match = /^([^,]+),(?:"((?:[^"]|"")*)"|([^"]*))$/.exec(line.trim());
    if (!match) throw new Error(`Bad CSV line ${i + 2}: ${line}`);
    const code = match[1]!.trim().toUpperCase().replace(/\s+/g, " ");
    const title = (match[2] !== undefined ? match[2].replace(/""/g, '"') : match[3]!).trim();
    if (!/^[A-Z]{2,4} \d{3}$/.test(code)) throw new Error(`Bad course code on line ${i + 2}: ${code}`);
    if (!title) throw new Error(`Missing title on line ${i + 2}`);
    return { code, title };
  });
}

// Inserts new courses and updates titles of existing ones. Safe to run any number of times.
export async function seedCourses(term: string, rows: CourseRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(courses)
    .values(rows.map((row) => ({ ...row, term })))
    .onConflictDoUpdate({
      target: [courses.code, courses.term],
      set: { title: sql`excluded.title` },
    });
  return rows.length;
}

export async function seedCoursesFromFile(term: string, path: string): Promise<number> {
  return seedCourses(term, parseCoursesCsv(await readFile(path, "utf8")));
}
