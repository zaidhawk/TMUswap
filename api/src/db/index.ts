import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { databaseUrl } from "./url.js";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });
