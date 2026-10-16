import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./auth/routes.js";
import { coursesRouter } from "./courses/routes.js";
import { requestsRouter } from "./requests/routes.js";
import { testRouter } from "./test-routes.js";

// The web app's address. Browsers block calls to the API from any other site.
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

// Builds the Express app without starting it, so tests can use it directly.
export function createApp() {
  const app = express();
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/courses", coursesRouter);
  app.use("/requests", requestsRouter);

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
