import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ApiError, type BoardRequest } from "./api";
import { KIND_LABELS } from "./sections";

// "just now", "5 min ago", "3 h ago", "2 days ago".
function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// Everyone's open requests, searchable by course. From here you can offer a swap even when your
// section isn't one they listed: they decide.
export function Board() {
  const [q, setQ] = useState("");
  const [requests, setRequests] = useState<BoardRequest[] | null>(null);
  const [error, setError] = useState("");

  // Search 250 ms after the student stops typing, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      api<{ requests: BoardRequest[] }>(`/board?q=${encodeURIComponent(q)}`)
        .then(({ requests }) => {
          setRequests(requests);
          setError("");
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the board."));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function offered(id: string) {
    setRequests((current) => current?.map((r) => (r.id === id ? { ...r, myOffer: "pending" } : r)) ?? null);
  }

  return (
    <section className="full">
      <h2>Board</h2>
      <p className="hint">
        Every open request, newest first. Find your course and offer a swap, even if your section isn't on their list.
        They decide.
      </p>
      <label>
        Search courses
        <input type="search" placeholder="CPS 706 or Networks" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}
      {!requests && !error && <p className="hint">Loading…</p>}
      {requests?.length === 0 && (
        <p>
          {q ? "No open requests for that course yet." : "No open requests yet."}{" "}
          <Link to="/new">Post one</Link> so others can find you.
        </p>
      )}
      {requests && requests.length > 0 && (
        <div className="cards">
          {requests.map((r) => (
            <BoardCard key={r.id} request={r} onOffered={() => offered(r.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardCard({ request: r, onOffered }: { request: BoardRequest; onOffered: () => void }) {
  const [open, setOpen] = useState(false);
  const [have, setHave] = useState("");
  const [noWaitlist, setNoWaitlist] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = KIND_LABELS[r.kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`/board/${r.id}/offers`, { method: "POST", body: { have, noWaitlist } });
      setOpen(false);
      onOffered();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <strong>{r.courseCode}</strong>
        <span className="badge">{kind}</span>
      </div>
      <p className="hint">{r.courseTitle}</p>
      <p>
        Has <strong>{r.have}</strong>, wants <strong>{r.wants.join(", ")}</strong>
      </p>
      <p className="hint">Posted {timeAgo(r.createdAt)}</p>

      {r.isMine && <p className="hint">This is your request.</p>}
      {r.myOffer === "pending" && <p className="hint">Offer sent. You'll hear back on My requests.</p>}
      {r.myOffer === "declined" && <p className="hint">They declined your offer.</p>}

      {!r.isMine && !r.myOffer && !open && (
        <button className="secondary" onClick={() => setOpen(true)}>
          Offer a swap
        </button>
      )}

      {open && (
        <form onSubmit={submit}>
          <label>
            Your {kind.toLowerCase()} section
            <input inputMode="numeric" placeholder="003" value={have} onChange={(e) => setHave(e.target.value)} required />
            <span className="hint">
              You'd give them this section and take their {r.have}. If they accept, you're matched and the chat opens.
            </span>
          </label>
          <label className="choice">
            <input type="checkbox" checked={noWaitlist} onChange={(e) => setNoWaitlist(e.target.checked)} />
            <span>Neither section has a wait list.</span>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button disabled={busy || !noWaitlist || !have.trim()}>{busy ? "Sending…" : "Send offer"}</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
