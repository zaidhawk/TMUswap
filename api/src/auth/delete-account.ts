import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { loginCodes, matches, matchMembers, swapRequests, users, type User } from "../db/schema.js";
import { endMatch, tryMatchRequest } from "../matching/engine.js";
import { emitToUsers } from "../realtime/io.js";

const ACTIVE = ["proposed", "accepted", "counting_down"] as const;

// Deletes a user and everything that belongs to them: sessions, login codes, requests, messages
// and reports (via ON DELETE CASCADE). Any match they're in is ended first, so the other
// students go straight back into the pool instead of waiting on someone who's gone.
export async function deleteAccount(user: User): Promise<void> {
  const { reopened, updates } = await db.transaction(async (tx) => {
    const active = await tx
      .select({ matchId: matchMembers.matchId })
      .from(matchMembers)
      .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
      .innerJoin(matches, eq(matches.id, matchMembers.matchId))
      .where(and(eq(swapRequests.userId, user.id), inArray(matches.status, [...ACTIVE])));

    const reopened: string[] = [];
    const updates: { matchId: string; userIds: string[] }[] = [];
    for (const { matchId } of active) {
      await tx.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId)).for("update");
      reopened.push(...(await endMatch(tx, matchId, (m) => (m.userId === user.id ? "cancelled" : "open"))));
      const others = await tx
        .select({ userId: swapRequests.userId })
        .from(matchMembers)
        .innerJoin(swapRequests, eq(swapRequests.id, matchMembers.requestId))
        .where(eq(matchMembers.matchId, matchId));
      updates.push({ matchId, userIds: others.map((o) => o.userId).filter((id) => id !== user.id) });
    }

    await tx.delete(loginCodes).where(eq(loginCodes.email, user.email));
    await tx.delete(users).where(eq(users.id, user.id));
    return { reopened, updates };
  });

  for (const { matchId, userIds } of updates) emitToUsers(userIds, "match:updated", { matchId });
  for (const requestId of reopened) await tryMatchRequest(requestId);
}
