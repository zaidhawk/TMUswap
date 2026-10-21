import { useEffect, useState } from "react";
import { api, ApiError, type Stats as StatsData } from "./api";

// "2026-10-21" → "Wed, Oct 21". Noon, so no time zone can push it onto another day.
function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Admin only: how the app is doing. Every number is a count; nothing here identifies anyone.
export function Stats() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<StatsData>("/admin/stats")
      .then(setStats)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the stats."));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="hint">Loading…</p>;

  const t = stats.totals;
  // For "raised the match rate by N%": students matched in 3-ways vs. in pairs.
  const inPairs = (t.matches - t.threeWayMatches) * 2;
  const inThreeWays = t.threeWayMatches * 3;
  const rows: [string, number][] = [
    ["Sign-ups (all time)", t.signUps],
    ["Accounts now", t.accounts],
    ["Requests posted", t.requestsPosted],
    ["Requests waiting for a match", t.openRequests],
    ["Matches made", t.matches],
    ["…of which 3-way", t.threeWayMatches],
    ["Matches everyone accepted", t.acceptedMatches],
    ["Swaps completed", t.completedSwaps],
    ["Swaps that failed", t.failedSwaps],
    ["Students who swapped", t.studentsSwapped],
  ];

  return (
    <section>
      <h2>Stats</h2>
      <p className="hint">Only admins can see this page. Deleted accounts still count toward sign-ups and requests.</p>

      <table className="stats">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {inThreeWays > 0 && (
        <p className="hint">
          3-way swaps matched {inThreeWays} students that pairs alone would have missed
          {inPairs > 0 && ` (${Math.round((inThreeWays / inPairs) * 100)}% more than the ${inPairs} matched in pairs)`}.
        </p>
      )}

      <h3>Last 14 days (Toronto time)</h3>
      <div className="table-scroll">
        <table className="stats">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Sign-ups</th>
              <th scope="col">Requests</th>
              <th scope="col">Matches</th>
              <th scope="col" title="Swaps completed">Done</th>
            </tr>
          </thead>
          <tbody>
            {stats.days.map((d) => (
              <tr key={d.date}>
                <th scope="row">{dayLabel(d.date)}</th>
                <td>{d.signUps}</td>
                <td>{d.requestsPosted}</td>
                <td>{d.matches}</td>
                <td>{d.completedSwaps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
