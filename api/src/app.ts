import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { authRouter } from "./auth/routes.js";
import { coursesRouter } from "./courses/routes.js";
import { requestsRouter } from "./requests/routes.js";
import { matchesRouter } from "./matching/routes.js";
import { reportsRouter } from "./reports/routes.js";
import { feedbackRouter } from "./feedback/routes.js";
import { boardRouter, offersRouter } from "./board/routes.js";
import { adminRouter } from "./admin/routes.js";
import { testRouter } from "./test-routes.js";

// Builds the Express app without starting it, so tests can use it directly.
export function createApp() {
  const app = express();
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/courses", coursesRouter);
  app.use("/requests", requestsRouter);
  app.use("/matches", matchesRouter);
  app.use("/reports", reportsRouter);
  app.use("/feedback", feedbackRouter);
  app.use("/board", boardRouter);
  app.use("/offers", offersRouter);
  app.use("/admin", adminRouter);

  if (process.env.NODE_ENV !== "production") {
    app.use("/test", testRouter);
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Any unexpected error: log the details for us, send the browser a plain JSON message.
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our end. Try again in a minute." });
  };
  app.use(handleError);

  return app;
}
