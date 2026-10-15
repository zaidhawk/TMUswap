import express from "express";

// Builds the Express app without starting it, so tests can use it directly.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
