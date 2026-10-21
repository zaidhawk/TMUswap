import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { config } from "../config.js";
import { findSessionUser } from "../auth/middleware.js";
import { SESSION_COOKIE } from "../auth/sessions.js";
import type { User } from "../db/schema.js";
import { isMatchMember, sendMessage } from "../chat/service.js";

let io: Server | null = null;

const userRoom = (userId: string) => `user:${userId}`;
const matchRoom = (matchId: string) => `match:${matchId}`;

// Sends an event to every open tab of these users. Does nothing when no server is attached
// (for example in API tests that don't need WebSockets).
export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  for (const id of userIds) io?.to(userRoom(id)).emit(event, payload);
}

// Sends an event to everyone viewing this match's chat.
export function emitToMatch(matchId: string, event: string, payload: unknown) {
  io?.to(matchRoom(matchId)).emit(event, payload);
}

// Reads one cookie from a raw Cookie header: "a=1; sid=abc" → "abc".
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

const matchIdSchema = z.uuid();
type Ack = (result: { ok: true; [key: string]: unknown } | { ok: false; error: string }) => void;

// A client can send anything, so check that the last argument really is a callback.
function ackFrom(value: unknown): Ack {
  return typeof value === "function" ? (value as Ack) : () => {};
}

export function attachRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, { cors: { origin: config.webOrigin, credentials: true } });

  // Log in with the same session cookie as the REST API. No valid session, no connection.
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.request.headers.cookie, SESSION_COOKIE);
      const user = token ? await findSessionUser(token) : null;
      if (!user || user.isBanned) return next(new Error("Not logged in"));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as User;
    socket.join(userRoom(user.id));

    // Open a match's chat. Only members get in.
    socket.on("match:join", async (rawMatchId: unknown, rawAck: unknown) => {
      const ack = ackFrom(rawAck);
      const matchId = matchIdSchema.safeParse(rawMatchId);
      if (!matchId.success || !(await isMatchMember(matchId.data, user.id))) {
        ack({ ok: false, error: "You're not part of this match" });
        return;
      }
      await socket.join(matchRoom(matchId.data));
      ack({ ok: true });
    });

    socket.on("message:send", async (raw: unknown, rawAck: unknown) => {
      const ack = ackFrom(rawAck);
      const input = z.object({ matchId: z.uuid(), body: z.unknown() }).safeParse(raw);
      if (!input.success) {
        ack({ ok: false, error: "Invalid message" });
        return;
      }
      try {
        const result = await sendMessage(user, input.data.matchId, input.data.body);
        if (!result.ok) {
          ack({ ok: false, error: result.error });
          return;
        }
        emitToMatch(input.data.matchId, "message:new", result.message);
        ack({ ok: true, message: result.message });
      } catch (err) {
        console.error("message:send failed:", err);
        ack({ ok: false, error: "Couldn't send your message. Try again." });
      }
    });

    // "Ann is typing…". Only relayed within a chat this socket has already joined.
    socket.on("typing", (raw: unknown) => {
      const matchId = matchIdSchema.safeParse((raw as { matchId?: unknown } | null)?.matchId);
      if (!matchId.success || !socket.rooms.has(matchRoom(matchId.data))) return;
      socket.to(matchRoom(matchId.data)).emit("typing", {
        matchId: matchId.data,
        displayName: user.displayName,
      });
    });
  });

  return io;
}
