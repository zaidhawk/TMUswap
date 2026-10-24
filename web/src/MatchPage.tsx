import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type Match, type User } from "./api";
import { getSocket } from "./socket";
import { KIND_LABELS } from "./sections";
import { Chat } from "./Chat";
import { Countdown } from "./Countdown";
import { ReportForm } from "./ReportForm";

const CHAT_OPEN = new Set<Match["status"]>(["accepted", "counting_down", "completed", "failed"]);

// "23h 05m left", or "less than a minute left".
function timeLeft(expiresAt: string, now: number): string {
  const minutes = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  if (minutes < 1) return "less than a minute left";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m left` : `${m}m left`;
}

export function MatchPage({ user }: { user: User }) {
  const { id } = useParams();
  const [match, setMatch] = useState<Match | null>(null);
  // Server clock minus this browser's clock, so the countdown is the same for everyone.
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const show = useCallback((m: Match) => {
    setMatch(m);
    setNow(Date.now());
    setClockOffset(new Date(m.serverTime).getTime() - Date.now());
  }, []);

  // Keeps "time left to accept" current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Load the match, and reload whenever the server says it changed (someone accepted,
  // pressed Start, and so on) or the connection comes back after a drop.
  useEffect(() => {
    let stopped = false;
    function load() {
      api<{ match: Match }>(`/matches/${id}`)
        .then(({ match }) => !stopped && show(match))
        .catch((e) => !stopped && setError(e instanceof ApiError ? e.message : "Couldn't load this match."));
    }
    function onUpdate(event: { matchId: string }) {
      if (event.matchId === id) load();
    }

    load();
    const socket = getSocket();
    socket.on("match:updated", onUpdate);
    socket.on("connect", load);
    return () => {
      stopped = true;
      socket.off("match:updated", onUpdate);
      socket.off("connect", load);
    };
  }, [id, show]);

  async function act(path: string, body: object, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    setBusy(true);
    try {
      const { match } = await api<{ match: Match }>(`/matches/${id}/${path}`, { method: "POST", body });
      show(match);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !match) {
    return (
      <section>
        <h2>This match isn't available</h2>
        <p>
          {error} It may have ended, or the link may be wrong. <Link to="/">Back to my requests</Link>
        </p>
      </section>
    );
  }
  if (!match) return <p className="hint">Loading…</p>;

  const me = match.members.find((m) => m.isMe)!;
  const others = match.members.filter((m) => !m.isMe);
  // Missing if that student has since deleted their account.
  const giverToMe = match.members.find((m) => m.gives === me.gets);

  const chatOpen = CHAT_OPEN.has(match.status);

  return (
    <section className={chatOpen ? "full match-layout with-chat" : "match-layout"}>
      <div className="match-info">
        <h2>
          {match.courseCode} {KIND_LABELS[match.kind].toLowerCase()} swap
        </h2>
        <p className="hint">
          {match.courseTitle} · {match.size === 2 ? "2-way" : "3-way"} swap
        </p>

        <div className="card">
          <p>
            You give <strong>{me.gives}</strong> and get <strong>{me.gets}</strong>
            {giverToMe ? ` from ${giverToMe.displayName}` : ""}.
          </p>
          {others.map((m) => (
            <p key={m.memberId} className="hint">
              {m.displayName} gives {m.gives}, gets {m.gets}
              {match.status === "proposed" && (m.accepted ? " · ✓ accepted" : " · hasn't answered yet")}
            </p>
          ))}
        </div>

        {match.status === "proposed" && (
          <>
            <p>
              {me.accepted
                ? "You accepted. Waiting for the others."
                : "Everyone has to accept before you can chat and coordinate the swap."}{" "}
              <span className="hint">({timeLeft(match.expiresAt, now + clockOffset)})</span>
            </p>
            {!me.accepted && (
              <div className="row">
                <button disabled={busy} onClick={() => act("accept", { accept: true })}>
                  Accept swap
                </button>
                <button
                  className="secondary danger"
                  disabled={busy}
                  onClick={() =>
                    act(
                      "accept",
                      { accept: false },
                      "Decline this swap? Your request will be cancelled, and you can post a new one.",
                    )
                  }
                >
                  Decline
                </button>
              </div>
            )}
          </>
        )}

        {match.status === "expired" && (
          <p>
            This match has ended. <Link to="/">Back to my requests</Link>
          </p>
        )}

        {error && <p className="error">{error}</p>}

        {chatOpen && (
          <Countdown
            match={match}
            clockOffset={clockOffset}
            busy={busy}
            onPress={(press) => act("start-countdown", { press })}
            onChooseFirst={(memberId) => act("first-mover", { memberId })}
            onOutcome={(outcome) => act("outcome", { outcome })}
          />
        )}
      </div>

      {chatOpen && (
        <div className="match-chat">
          <Chat matchId={match.id} myUserId={user.id} canSend={chatOpen} />
        </div>
      )}
      <div className="match-report">
        <ReportForm matchId={match.id} others={others} />
      </div>
    </section>
  );
}
