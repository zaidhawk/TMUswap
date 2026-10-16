import { config } from "../config.js";
import { seedCoursesFromFile } from "../courses/seed.js";
import { pool } from "./index.js";

// Loads data/courses-<term>.csv into the database. Run from the api folder.
const count = await seedCoursesFromFile(config.currentTerm, `data/courses-${config.currentTerm}.csv`);
console.log(`Seeded ${count} courses for ${config.currentTerm}`);
await pool.end();
