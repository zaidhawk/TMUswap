import { and, count, desc, eq, gt, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { matches, matchMembers, messages, swapRequests, users, type User } from "../db/schema.js";

export const MAX_MESSAGES_PER_MINUTE = 30;
export const PAGE_SIZE = 50;

// Chat opens once everyone has accepted, and stays readable after the swap.
const CHAT_OPEN = new Set(["accepted", "counting_down", "completed", "failed"]);

const messageBody = z
  .string({ error: "Write a message first" })
  .trim()
  .min(1, "Write a message first")
  .max(1000, "Messages can be at most 1,000 characters");

export type ChatMessage = {
  id: string;
  matchId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  createdAt: Date;
};

export async function isMatchMember(matchId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ requestId: matchMembers.requestId })
    .from(matchMembers)
    .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
    .where(and(eq(matchMembers.matchId, matchId), eq(swapRequests.userId, userId)));
  return row !== undefined;
}

type SendResult = { ok: true; message: ChatMessage } | { ok: false; status: number; error: string };

export async function sendMessage(user: User, matchId: string, rawBody: unknown): Promise<SendResult> {
  const body = messageBody.safeParse(rawBody);
  if (!body.success) return { ok: false, status: 400, error: body.error.issues[0]!.message };

  const [match] = await db.select({ status: matches.status }).from(matches).where(eq(matches.id, matchId));
  if (!match || !(await isMatchMember(matchId, user.id))) {
    return { ok: false, status: 403, error: "You're not part of this match" };
  }
  if (!CHAT_OPEN.has(match.status)) {
    return { ok: false, status: 409, error: "Chat opens once everyone has accepted the swap" };
  }

  const [recent] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.senderId, user.id), gt(messages.createdAt, new Date(Date.now() - 60_000))));
  if ((recent?.n ?? 0) >= MAX_MESSAGES_PER_MINUTE) {
    return { ok: false, status: 429, error: "You're sending messages too fast. Wait a minute." };
  }

  const [saved] = await db
    .insert(messages)
    .values({ matchId, senderId: user.id, body: body.data })
    .returning();
  return {
    ok: true,
    message: { ...saved!, senderName: user.displayName },
  };
}

// One page of chat history, oldest first. Pass the id of the oldest message you already have
// as `before` to load the 50 messages before it.
export async function loadMessages(matchId: string, before?: string): Promise<ChatMessage[]> {
  let cursor: { createdAt: Date; id: string } | undefined;
  if (before) {
    [cursor] = await db
      .select({ createdAt: messages.createdAt, id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, before), eq(messages.matchId, matchId)));
    if (!cursor) return [];
  }

  const rows = await db
    .select({
      id: messages.id,
      matchId: messages.matchId,
      senderId: messages.senderId,
      senderName: users.displayName,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(
      and(
        eq(messages.matchId, matchId),
        cursor
          ? or(
              lt(messages.createdAt, cursor.createdAt),
              and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(PAGE_SIZE);

  return rows.reverse();
}
