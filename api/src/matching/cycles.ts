// An open request as the matcher sees it. `have` and `wants` are section ids.
export type OpenRequest = {
  id: string;
  userId: string;
  have: string;
  wants: Set<string>;
  createdAt: Date;
};

// A cycle of request ids. Each request gets the section of the next one; the last gets the first's.
export type Cycle = string[];

// Looks for a 3-way swap that includes `startId`: start wants B's section, B wants C's, and
// C wants start's. All three must be different students. Among several options, the one
// with the oldest requests wins, so nobody who posted early gets skipped.
export function findTriangle(startId: string, requests: OpenRequest[]): Cycle | null {
  const start = requests.find((r) => r.id === startId);
  if (!start) return null;

  const options: [OpenRequest, OpenRequest][] = [];
  for (const b of requests) {
    if (b.id === start.id || b.userId === start.userId || !start.wants.has(b.have)) continue;
    for (const c of requests) {
      if (c.id === start.id || c.id === b.id) continue;
      if (c.userId === start.userId || c.userId === b.userId) continue;
      if (b.wants.has(c.have) && c.wants.has(start.have)) options.push([b, c]);
    }
  }
  if (options.length === 0) return null;

  options.sort(
    ([b1, c1], [b2, c2]) =>
      b1.createdAt.getTime() - b2.createdAt.getTime() || c1.createdAt.getTime() - c2.createdAt.getTime(),
  );
  const [b, c] = options[0]!;
  return [start.id, b.id, c.id];
}
