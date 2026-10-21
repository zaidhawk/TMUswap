import { defineConfig } from "vitest/config";

// Tests get their own database so they can create and wipe data freely.
// Set here (not in test.env) so the global setup sees it too.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://tmuswap:tmuswap@localhost:5432/tmuswap_test";

export default defineConfig({
  test: {
    env: { NODE_ENV: "test" },
    globalSetup: ["./test/global-setup.ts"],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Startup scripts, run by hand or on deploy rather than by tests.
      exclude: ["src/index.ts", "src/db/migrate.ts", "src/db/seed.ts", "src/**/*.d.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
