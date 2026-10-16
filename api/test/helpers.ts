import request from "supertest";
import type { Express } from "express";
import { lastCodeSentTo } from "../src/email.js";

// The session cookie header from a response, e.g. "sid=abc; Max-Age=...; HttpOnly".
export function sessionCookie(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("sid="));
}

// Logs in through the real request-code and verify routes. The agent keeps the cookie,
// so later requests made with it are logged in.
export async function login(app: Express, email = "student@torontomu.ca") {
  const agent = request.agent(app);
  await agent.post("/auth/request-code").send({ email }).expect(200);
  const code = lastCodeSentTo(email)!;
  const res = await agent.post("/auth/verify").send({ email, code }).expect(200);
  return { agent, res };
}
