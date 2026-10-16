import { Router } from "express";
import { lastCodeSentTo } from "./email.js";

// Helpers for automated tests (Playwright). Never mounted in production.
export const testRouter = Router();

testRouter.get("/last-code", (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
  const code = lastCodeSentTo(email);
  if (!code) {
    res.status(404).json({ error: "No code sent to that email" });
    return;
  }
  res.json({ code });
});
