import { describe, expect, it } from "vitest";
import { countdownBlockedReason, isMyServiceHubDown, swapSteps } from "../src/matching/countdown.js";

// Toronto is UTC-5 in winter (EST) and UTC-4 in summer (EDT).
const winter = (hhmm: string) => new Date(`2027-01-05T${hhmm}:00-05:00`);
const summer = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00-04:00`);

describe("isMyServiceHubDown", () => {
  it.each([
    ["11:44 pm", "23:44", false],
    ["11:45 pm", "23:45", true],
    ["midnight", "00:00", true],
    ["1:14 am", "01:14", true],
    ["1:15 am", "01:15", false],
    ["noon", "12:00", false],
  ])("at %s Toronto time → %s", (_label, hhmm, down) => {
    expect(isMyServiceHubDown(winter(hhmm))).toBe(down);
    expect(isMyServiceHubDown(summer(hhmm))).toBe(down);
  });
});

describe("countdownBlockedReason", () => {
  it("allows countdowns during the day", () => {
    expect(countdownBlockedReason(winter("14:00"), null)).toBeNull();
  });

  it("explains the nightly downtime", () => {
    expect(countdownBlockedReason(winter("23:50"), null)).toContain("maintenance");
  });

  it("blocks swaps after the last day to enrol, in Toronto time", () => {
    expect(countdownBlockedReason(winter("23:00"), "2027-01-05")).toBeNull();
    // 00:30 UTC on Jan 6 is still Jan 5 in Toronto (7:30 pm).
    expect(countdownBlockedReason(new Date("2027-01-06T00:30:00Z"), "2027-01-05")).toBeNull();
    expect(countdownBlockedReason(new Date("2027-01-06T14:00:00-05:00"), "2027-01-05")).toContain(
      "last day to enrol",
    );
  });
});

describe("swapSteps", () => {
  const ann = { memberId: "a", displayName: "Ann", gives: "011", gets: "012", isMe: true };
  const bob = { memberId: "b", displayName: "Bob", gives: "012", gets: "011", isMe: false };

  it("orders a 2-way swap: drop, swap in, add", () => {
    expect(swapSteps([ann, bob], "a")).toEqual([
      { memberId: "a", displayName: "Ann", isMe: true, action: "drop", from: "011" },
      { memberId: "b", displayName: "Bob", isMe: false, action: "swap", from: "012", to: "011" },
      { memberId: "a", displayName: "Ann", isMe: true, action: "add", to: "012" },
    ]);
  });

  it("works whoever goes first", () => {
    expect(swapSteps([ann, bob], "b").map((s) => [s.displayName, s.action])).toEqual([
      ["Bob", "drop"],
      ["Ann", "swap"],
      ["Bob", "add"],
    ]);
  });

  it("orders a 3-way swap so each person moves into the seat just freed", () => {
    // Ann gets Bob's 012, Bob gets Cat's 013, Cat gets Ann's 011.
    const a = { memberId: "a", displayName: "Ann", gives: "011", gets: "012", isMe: true };
    const b = { memberId: "b", displayName: "Bob", gives: "012", gets: "013", isMe: false };
    const c = { memberId: "c", displayName: "Cat", gives: "013", gets: "011", isMe: false };

    expect(swapSteps([a, b, c], "a").map((s) => [s.displayName, s.action, s.from ?? "", s.to ?? ""])).toEqual([
      ["Ann", "drop", "011", ""],
      ["Cat", "swap", "013", "011"], // Cat wants 011, which Ann just freed
      ["Bob", "swap", "012", "013"], // Bob wants 013, which Cat just freed
      ["Ann", "add", "", "012"], // Ann takes 012, which Bob just freed
    ]);
  });

  it("returns no steps for an unknown first member", () => {
    expect(swapSteps([ann, bob], "zzz")).toEqual([]);
  });
});
