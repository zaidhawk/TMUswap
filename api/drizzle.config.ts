import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./src/db/url.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
