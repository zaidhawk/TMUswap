// Starts the API for end-to-end tests against a brand-new database: build, create the
// database, migrate, load the course list, then run the production build of the server.
import { execSync, spawn } from "node:child_process";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error(`Refusing to reset non-local database ${url.hostname}`);
}

const admin = new pg.Client({ connectionString: new URL("/postgres", url).toString() });
await admin.connect();
const dbName = url.pathname.slice(1);
await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();

const run = (cmd) => execSync(cmd, { cwd: "..", stdio: "inherit", env: process.env });
run("npm run build -w api");
run("npm run db:migrate:prod -w api");
run("npm run db:seed:prod -w api");

const server = spawn("npm", ["run", "start", "-w", "api"], {
  cwd: "..",
  stdio: "inherit",
  env: process.env,
  shell: true,
});
server.on("exit", (code) => process.exit(code ?? 0));
