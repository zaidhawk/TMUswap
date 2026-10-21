import { and, count, desc, eq, gt, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { courses, matches, matchMembers, messages, sections, swapRequests, users, type User } from "../db/schema.js";
import { sendAdminAlert } from "../email.js";

export const MAX_MESSAGES_PER_MINUTE = 30;
export const PAGE_SIZE = 50;

// Selling seats is against the rules (and TMU's), so the first chat message in a match that
// mentions money is emailed to the admin to review. It's a nudge for a human, not a block.
export const MONEY_PATTERN =
  /\$\s?\d|\d+\s?(dollars|bucks)|e-?transfer|interac|paypal|venmo|cash\s?app|\b(cash|money|pay|paid|paying|payment|sell|selling|buy|buying)\b/i;

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
  if (MONEY_PATTERN.test(body.data)) {
    flagMoneyMention(user, matchId, saved!.id).catch((err) => console.error("Money flag failed:", err));
  }
  return {
    ok: true,
    message: { ...saved!, senderName: user.displayName },
  };
}

// Emails the admin the first time money comes up in a match's chat (later mentions in the
// same chat don't send more emails).
async function flagMoneyMention(user: User, matchId: string, messageId: string) {
  const earlier = await db
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(eq(messages.matchId, matchId));
  if (earlier.some((m) => m.id !== messageId && MONEY_PATTERN.test(m.body))) return;

  const recent = await loadMessages(matchId);
  await sendAdminAlert(
    `Money mentioned in a ${(await matchCourseCode(matchId)) ?? ""} chat`,
    [
      `${user.displayName} (${user.email}) mentioned money in match ${matchId}.`,
      "",
      "Recent messages:",
      ...recent.slice(-15).map((m) => `  ${m.senderName}: ${m.body}`),
    ].join("\n"),
  );
}

// The course code of a match, for admin emails.
export async function matchCourseCode(matchId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ code: courses.code })
    .from(matchMembers)
    .innerJoin(sections, eq(sections.id, matchMembers.givesSectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(eq(matchMembers.matchId, matchId))
    .limit(1);
  return row?.code;
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
