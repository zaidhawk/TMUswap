import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

// Applies any migrations in /drizzle that haven't run on this database yet.
await migrate(db, { migrationsFolder: "drizzle" });
console.log("Migrations applied");
await pool.end();
