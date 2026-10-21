import { config } from "../config.js";

export const COUNTDOWN_LEAD_MS = 10_000;

// The current time, as the countdown rules see it. Tests replace now() to check the nightly
// downtime without depending on when they happen to run.
export const clock = { now: () => new Date() };

// The time of day in Toronto as "HH:MM", and the date as "YYYY-MM-DD".
function torontoParts(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    day: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// MyServiceHub is down for maintenance every night from 12:00 to 1:15 am. We stop countdowns from
// 11:45 pm, so nobody drops a section and then can't get back in.
export function isMyServiceHubDown(date: Date): boolean {
  const { minutes } = torontoParts(date);
  return minutes >= 23 * 60 + 45 || minutes < 60 + 15;
}

// Why a countdown can't start right now, or null if it can.
export function countdownBlockedReason(date: Date, lastDayToEnrol = config.lastDayToEnrol): string | null {
  if (lastDayToEnrol && torontoParts(date).day > lastDayToEnrol) {
    return "The last day to enrol has passed, so MyServiceHub no longer allows swaps this term.";
  }
  if (isMyServiceHubDown(date)) {
    return "MyServiceHub is down for maintenance from 12:00 to 1:15 am, so countdowns are paused from 11:45 pm to 1:15 am.";
  }
  return null;
}

type Member = { memberId: string; displayName: string | null; gives: string; gets: string; isMe: boolean };

export type Step = {
  memberId: string;
  displayName: string | null;
  isMe: boolean;
  action: "drop" | "swap" | "add";
  from?: string;
  to?: string;
};

// The order of moves in MyServiceHub. The first person drops their section; each next person
// uses Swap to move into the seat that was just freed (freeing their own); finally the first
// person adds the last freed seat. Only the first person is ever without a seat.
export function swapSteps(members: Member[], firstMemberId: string): Step[] {
  const first = members.find((m) => m.memberId === firstMemberId);
  if (!first) return [];
  const step = (m: Member, action: Step["action"], extra: Partial<Step>): Step => ({
    memberId: m.memberId,
    displayName: m.displayName,
    isMe: m.isMe,
    action,
    ...extra,
  });

  const steps: Step[] = [step(first, "drop", { from: first.gives })];
  let freed = first.gives;
  for (let i = 1; i < members.length; i++) {
    const next = members.find((m) => m.gets === freed && m.memberId !== first.memberId);
    if (!next) return [];
    steps.push(step(next, "swap", { from: next.gives, to: freed }));
    freed = next.gives;
  }
  steps.push(step(first, "add", { to: freed }));
  return steps;
}
