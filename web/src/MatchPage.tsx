import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type Match } from "./api";
import { KIND_LABELS } from "./sections";

const REFRESH_MS = 15_000;

// "23h 05m left", or "less than a minute left".
function timeLeft(expiresAt: string, now: number): string {
  const minutes = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  if (minutes < 1) return "less than a minute left";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m left` : `${m}m left`;
}

export function MatchPage() {
  const { id } = useParams();
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Load the match, then refresh every 15 seconds while we wait for the others to answer.
  // (Week 5 replaces this polling with live updates over a WebSocket.)
  useEffect(() => {
    let stopped = false;
    function load() {
      api<{ match: Match }>(`/matches/${id}`)
        .then(({ match }) => {
          if (!stopped) setMatch(match);
        })
        .catch((e) => {
          if (!stopped) setError(e instanceof ApiError ? e.message : "Couldn't load this match.");
        });
      setNow(Date.now());
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id]);

  async function answer(accept: boolean) {
    if (!accept && !window.confirm("Decline this swap? Your request will be cancelled, and you can post a new one.")) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { match } = await api<{ match: Match }>(`/matches/${id}/accept`, { method: "POST", body: { accept } });
      setMatch(match);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !match) return <p className="error">{error}</p>;
  if (!match) return <p className="hint">Loading…</p>;

  const me = match.members.find((m) => m.isMe)!;
  const others = match.members.filter((m) => !m.isMe);
  const giverToMe = match.members.find((m) => m.gives === me.gets)!;

  return (
    <section>
      <h2>
        {match.courseCode} {KIND_LABELS[match.kind].toLowerCase()} swap
      </h2>
      <p className="hint">
        {match.courseTitle} · {match.size === 2 ? "2-way" : "3-way"} swap
      </p>

      <div className="card">
        <p>
          You give <strong>{me.gives}</strong> and get <strong>{me.gets}</strong> from {giverToMe.displayName}.
        </p>
        {others.map((m) => (
          <p key={m.displayName} className="hint">
            {m.displayName} gives {m.gives}, gets {m.gets} · {m.accepted ? "✓ accepted" : "hasn't answered yet"}
          </p>
        ))}
      </div>

      {match.status === "proposed" && (
        <>
          <p>
            {me.accepted
              ? "You accepted. Waiting for the others."
              : "Everyone has to accept before you can coordinate the swap."}{" "}
            <span className="hint">({timeLeft(match.expiresAt, now)})</span>
          </p>
          {!me.accepted && (
            <div className="row">
              <button disabled={busy} onClick={() => answer(true)}>
                Accept swap
              </button>
              <button className="secondary danger" disabled={busy} onClick={() => answer(false)}>
                Decline
              </button>
            </div>
          )}
        </>
      )}

      {match.status === "accepted" && (
        <p>Everyone accepted! Next you'll chat to plan the swap and press Start countdown together (coming soon).</p>
      )}

      {match.status === "expired" && (
        <p>
          This match has ended. <Link to="/">Back to my requests</Link>
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
