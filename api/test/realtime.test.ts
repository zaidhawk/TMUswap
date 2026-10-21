import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connectClient, type Socket } from "socket.io-client";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { courses, messages, users } from "../src/db/schema.js";
import { seedCourses } from "../src/courses/seed.js";
import { attachRealtime, readCookie } from "../src/realtime/io.js";
import { clock } from "../src/matching/countdown.js";
import { resetDb } from "./db.js";
import { loginReady } from "./helpers.js";

const app = createApp();
let server: HttpServer;
let url: string;
let courseId: string;
const sockets: Socket[] = [];
const realNow = clock.now;

beforeAll(async () => {
  server = createServer(app);
  const io = attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
  afterAll(async () => {
    await io.close();
    await pool.end();
  });
});

beforeEach(async () => {
  await resetDb();
  await seedCourses("2027W", [{ code: "CPS 510", title: "Database Systems I" }]);
  courseId = (await db.select().from(courses))[0]!.id;
  clock.now = () => new Date("2027-01-05T14:00:00-05:00");
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
  clock.now = realNow;
});

// Opens a live connection, logged in with `cookie` (or not logged in at all).
function connect(cookie?: string): Promise<Socket> {
  const socket = connectClient(url, {
    transports: ["websocket"],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

// Resolves with the next `event` this socket receives, or fails after 2 seconds.
function next<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No "${event}" received`)), 2000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// True if the socket receives `event` within `ms`.
function receives(socket: Socket, event: string, ms = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

type Ack = { ok: boolean; error?: string; message?: { body: string; senderName: string } };
const emit = (socket: Socket, event: string, payload: unknown) =>
  socket.timeout(2000).emitWithAck(event, payload) as Promise<Ack>;

type Student = Awaited<ReturnType<typeof loginReady>>;

async function post(student: Student, have: string, wants: string[]) {
  const res = await student.agent
    .post("/requests")
    .send({ courseId, kind: "lecture", have, wants, noWaitlist: true })
    .expect(201);
  return res.body.request as { id: string; matchId: string | null };
}

// ann and bob matched and (by default) both accepted, so their chat is open.
async function pairMatch({ accepted = true } = {}) {
  const ann = await loginReady(app, "ann@torontomu.ca");
  const bob = await loginReady(app, "bob@torontomu.ca");
  await post(ann, "011", ["012"]);
  const matchId = (await post(bob, "012", ["011"])).matchId!;
  if (accepted) {
    await ann.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
    await bob.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);
  }
  return { ann, bob, matchId };
}

// Connects and opens the match's chat.
async function joined(student: Student, matchId: string) {
  const socket = await connect(student.cookie);
  expect(await emit(socket, "match:join", matchId)).toEqual({ ok: true });
  return socket;
}

describe("readCookie", () => {
  it("finds one cookie in a Cookie header", () => {
    expect(readCookie("theme=dark; sid=abc%3D; x=1", "sid")).toBe("abc=");
    expect(readCookie("theme=dark", "sid")).toBeUndefined();
    expect(readCookie(undefined, "sid")).toBeUndefined();
  });
});

describe("connecting", () => {
  it("rejects a connection without a session cookie", async () => {
    await expect(connect()).rejects.toThrow("Not logged in");
  });

  it("rejects a made-up session cookie", async () => {
    await expect(connect("sid=forged")).rejects.toThrow("Not logged in");
  });

  it("rejects a banned user", async () => {
    const ann = await loginReady(app, "ann@torontomu.ca");
    await db.update(users).set({ isBanned: true }).where(eq(users.id, ann.userId));

    await expect(connect(ann.cookie)).rejects.toThrow("Not logged in");
  });

  it("accepts a logged-in user", async () => {
    const ann = await loginReady(app, "ann@torontomu.ca");

    expect((await connect(ann.cookie)).connected).toBe(true);
  });
});

describe("match rooms", () => {
  it("lets members join and keeps everyone else out", async () => {
    const { ann, matchId } = await pairMatch();
    const eve = await loginReady(app, "eve@torontomu.ca");

    expect(await emit(await connect(ann.cookie), "match:join", matchId)).toEqual({ ok: true });
    expect(await emit(await connect(eve.cookie), "match:join", matchId)).toEqual({
      ok: false,
      error: "You're not part of this match",
    });
  });

  it("refuses a malformed match id", async () => {
    const ann = await loginReady(app, "ann@torontomu.ca");

    expect((await emit(await connect(ann.cookie), "match:join", "nope")).ok).toBe(false);
  });
});

describe("chat", () => {
  it("delivers a message to everyone in the chat and saves it", async () => {
    const { ann, bob, matchId } = await pairMatch();
    const annSocket = await joined(ann, matchId);
    const bobSocket = await joined(bob, matchId);
    const bobGets = next<{ body: string; senderName: string }>(bobSocket, "message:new");

    const ack = await emit(annSocket, "message:send", { matchId, body: "  Hi! Ready at 3?  " });

    expect(ack.ok).toBe(true);
    expect(await bobGets).toMatchObject({ body: "Hi! Ready at 3?", senderName: "Student ann" });
    const history = (await bob.agent.get(`/matches/${matchId}/messages`)).body.messages;
    expect(history.map((m: { body: string }) => m.body)).toEqual(["Hi! Ready at 3?"]);
  });

  it("never lets a non-member send, even without joining the room", async () => {
    const { ann, matchId } = await pairMatch();
    const annSocket = await joined(ann, matchId);
    const eve = await loginReady(app, "eve@torontomu.ca");
    const eveSocket = await connect(eve.cookie);
    const annHears = receives(annSocket, "message:new");

    const ack = await emit(eveSocket, "message:send", { matchId, body: "buy my seat" });

    expect(ack).toEqual({ ok: false, error: "You're not part of this match" });
    expect(await annHears).toBe(false);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("stays closed until everyone has accepted", async () => {
    const { ann, matchId } = await pairMatch({ accepted: false });

    const ack = await emit(await connect(ann.cookie), "message:send", { matchId, body: "hi" });

    expect(ack).toEqual({ ok: false, error: "Chat opens once everyone has accepted the swap" });
  });

  it.each([
    ["an empty message", "   ", "Write a message first"],
    ["a message over 1,000 characters", "x".repeat(1001), "Messages can be at most 1,000 characters"],
    ["a non-text message", { html: "<b>hi</b>" }, "Write a message first"],
  ])("rejects %s", async (_name, body, error) => {
    const { ann, matchId } = await pairMatch();

    const ack = await emit(await connect(ann.cookie), "message:send", { matchId, body });

    expect(ack).toEqual({ ok: false, error });
  });

  it("keeps message text exactly as typed (the page shows it as plain text, never HTML)", async () => {
    const { ann, matchId } = await pairMatch();

    const ack = await emit(await connect(ann.cookie), "message:send", {
      matchId,
      body: "<script>alert(1)</script>",
    });

    expect(ack.message?.body).toBe("<script>alert(1)</script>");
  });

  it("allows 30 messages a minute, then refuses", async () => {
    const { ann, matchId } = await pairMatch();
    const socket = await connect(ann.cookie);
    for (let i = 0; i < 30; i++) {
      expect((await emit(socket, "message:send", { matchId, body: `msg ${i}` })).ok).toBe(true);
    }

    const ack = await emit(socket, "message:send", { matchId, body: "one too many" });

    expect(ack).toEqual({ ok: false, error: "You're sending messages too fast. Wait a minute." });
  });

  it("relays typing to the others, not back to the typer", async () => {
    const { ann, bob, matchId } = await pairMatch();
    const annSocket = await joined(ann, matchId);
    const bobSocket = await joined(bob, matchId);
    const bobSees = next<{ displayName: string }>(bobSocket, "typing");
    const annSees = receives(annSocket, "typing");

    annSocket.emit("typing", { matchId });

    expect(await bobSees).toMatchObject({ displayName: "Student ann" });
    expect(await annSees).toBe(false);
  });

  it("doesn't relay typing from a socket that never joined the chat", async () => {
    const { bob, matchId } = await pairMatch();
    const bobSocket = await joined(bob, matchId);
    const eve = await loginReady(app, "eve@torontomu.ca");
    const eveSocket = await connect(eve.cookie);
    const bobSees = receives(bobSocket, "typing");

    eveSocket.emit("typing", { matchId });

    expect(await bobSees).toBe(false);
  });
});

describe("live match updates", () => {
  it("tells both students the moment they're matched", async () => {
    const ann = await loginReady(app, "ann@torontomu.ca");
    const bob = await loginReady(app, "bob@torontomu.ca");
    const annSocket = await connect(ann.cookie);
    const annHears = next<{ matchId: string }>(annSocket, "match:new");
    await post(ann, "011", ["012"]);

    const { matchId } = await post(bob, "012", ["011"]);

    expect(await annHears).toEqual({ matchId });
  });

  it("tells the others when someone accepts", async () => {
    const { ann, bob, matchId } = await pairMatch({ accepted: false });
    const bobSocket = await connect(bob.cookie);
    const bobHears = next<{ matchId: string }>(bobSocket, "match:updated");

    await ann.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);

    expect(await bobHears).toEqual({ matchId });
  });

  it("tells everyone when the countdown starts", async () => {
    const { ann, bob, matchId } = await pairMatch();
    await ann.agent.post(`/matches/${matchId}/start-countdown`).send({ press: true }).expect(200);
    const annSocket = await connect(ann.cookie);
    const annHears = next(annSocket, "match:updated");

    await bob.agent.post(`/matches/${matchId}/start-countdown`).send({ press: true }).expect(200);

    await annHears;
    const view = (await ann.agent.get(`/matches/${matchId}`)).body.match;
    expect(view.status).toBe("counting_down");
  });

  it("doesn't tell students outside the match", async () => {
    const { ann, matchId } = await pairMatch({ accepted: false });
    const eve = await loginReady(app, "eve@torontomu.ca");
    const eveSocket = await connect(eve.cookie);
    const eveHears = receives(eveSocket, "match:updated");

    await ann.agent.post(`/matches/${matchId}/accept`).send({ accept: true }).expect(200);

    expect(await eveHears).toBe(false);
  });
});
