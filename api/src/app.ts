import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./auth/routes.js";
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

  if (process.env.NODE_ENV !== "production") {
    app.use("/test", testRouter);
  }

  return app;
}
