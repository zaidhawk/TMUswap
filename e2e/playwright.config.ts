import { defineConfig, devices } from "@playwright/test";

// Separate ports from `npm run dev`, so end-to-end tests can run while you develop.
const API_URL = "http://localhost:3100";
const WEB_URL = "http://localhost:4173";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  // The tests share one database and one server, so run them one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    // On failure, keep a step-by-step recording (screenshots, network, console) to debug with.
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The API: production build, fresh database.
      command: "node scripts/start-api.mjs",
      url: `${API_URL}/health`,
      timeout: 180_000,
      env: {
        PORT: "3100",
        NODE_ENV: "e2e",
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://tmuswap:tmuswap@localhost:5432/tmuswap_e2e",
        WEB_ORIGIN: WEB_URL,
        // 2 pm in Toronto, so the nightly MyServiceHub downtime never blocks the countdown test.
        FIXED_COUNTDOWN_TIME: "2027-01-05T14:00:00-05:00",
      },
    },
    {
      // The web app: production build, served the way Vercel would serve it.
      command: "npm run build -w web && npm run preview -w web -- --port 4173 --strictPort",
      cwd: "..",
      url: WEB_URL,
      timeout: 180_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
