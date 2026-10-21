import { describe, expect, it } from "vitest";
import { findTriangle, type OpenRequest } from "../src/matching/cycles.js";

let clock = 0;
// A request from `user` who has section `have` and wants `wants`. Each call is one minute newer.
function req(id: string, user: string, have: string, wants: string[]): OpenRequest {
  clock += 1;
  return { id, userId: user, have, wants: new Set(wants), createdAt: new Date(clock * 60_000) };
}

describe("findTriangle", () => {
  it("finds a 3-way swap", () => {
    const requests = [
      req("a", "ann", "011", ["012"]),
      req("b", "bob", "012", ["013"]),
      req("c", "cat", "013", ["011"]),
    ];

    // a gets b's 012, b gets c's 013, c gets a's 011.
    expect(findTriangle("a", requests)).toEqual(["a", "b", "c"]);
    // The same cycle, seen from whichever request was just posted.
    expect(findTriangle("c", requests)).toEqual(["c", "a", "b"]);
  });

  it("returns null when the cycle doesn't close", () => {
    const requests = [
      req("a", "ann", "011", ["012"]),
      req("b", "bob", "012", ["013"]),
      req("c", "cat", "013", ["014"]),
    ];

    expect(findTriangle("a", requests)).toBeNull();
  });

  it("never puts the same student in a swap twice", () => {
    const requests = [
      req("a", "ann", "011", ["012"]),
      req("b", "bob", "012", ["013"]),
      req("c", "ann", "013", ["011"]), // ann again, with a second request
    ];

    expect(findTriangle("a", requests)).toBeNull();
  });

  it("prefers the oldest requests", () => {
    const requests = [
      req("b-old", "bob", "012", ["013"]),
      req("c-old", "cat", "013", ["011"]),
      req("b-new", "ben", "012", ["013"]),
      req("c-new", "cal", "013", ["011"]),
      req("a", "ann", "011", ["012"]),
    ];

    expect(findTriangle("a", requests)).toEqual(["a", "b-old", "c-old"]);
  });

  it("works when requests accept several sections", () => {
    const requests = [
      req("a", "ann", "011", ["012", "015"]),
      req("b", "bob", "015", ["013", "019"]),
      req("c", "cat", "013", ["011", "012"]),
    ];

    expect(findTriangle("a", requests)).toEqual(["a", "b", "c"]);
  });

  it("returns null for an unknown request", () => {
    expect(findTriangle("missing", [req("a", "ann", "011", ["012"])])).toBeNull();
  });
});
