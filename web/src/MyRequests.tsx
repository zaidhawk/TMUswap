import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, type ReceivedOffer, type SentOffer, type SwapRequest } from "./api";
import { ReceivedOffers, SentOffers } from "./Offers";
import { KIND_LABELS, parseSectionList } from "./sections";
import { getSocket } from "./socket";

type OffersData = { received: ReceivedOffer[]; sent: SentOffer[] };

export function MyRequests() {
  const [requests, setRequests] = useState<SwapRequest[] | null>(null);
  const [offers, setOffers] = useState<OffersData>({ received: [], sent: [] });
  const [error, setError] = useState("");

  const loadOffers = useCallback(() => {
    api<OffersData>("/offers")
      .then(setOffers)
      .catch(() => {}); // the requests list still works without them
  }, []);

  // Load your requests and offers, and reload live when a match or an offer changes.
  useEffect(() => {
    function load() {
      api<{ requests: SwapRequest[] }>("/requests/mine")
        .then(({ requests }) => setRequests(requests))
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your requests."));
      loadOffers();
    }
    load();
    const socket = getSocket();
    const events = ["match:new", "match:updated", "offer:new", "offer:updated"];
    for (const event of events) socket.on(event, load);
    return () => {
      for (const event of events) socket.off(event, load);
    };
  }, [loadOffers]);

  function replace(updated: SwapRequest) {
    setRequests((current) => current?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
  }

  if (error) return <p className="error">{error}</p>;
  if (!requests) return <p className="hint">Loading…</p>;

  const open = requests.filter((r) => r.status === "open" || r.status === "matched");
  const past = requests.filter((r) => r.status !== "open" && r.status !== "matched");

  return (
    <section className="full">
      <h2>My requests</h2>
      <ReceivedOffers offers={offers.received} onChange={loadOffers} />
      {offers.received.length > 0 && <h3>Your requests</h3>}
      {open.length === 0 && (
        <p>
          You have no open requests. <Link to="/new">Post one</Link> to get matched, or browse the{" "}
          <Link to="/board">Board</Link>.
        </p>
      )}
      {open.length > 0 && (
        <div className="cards">
          {open.map((r) => (
            <RequestCard key={r.id} request={r} onChange={replace} />
          ))}
        </div>
      )}
      <SentOffers offers={offers.sent} onChange={loadOffers} />
      {past.length > 0 && (
        <>
          <h3>Past requests</h3>
          <div className="cards">
            {past.map((r) => (
              <RequestCard key={r.id} request={r} onChange={replace} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RequestCard({ request, onChange }: { request: SwapRequest; onChange: (r: SwapRequest) => void }) {
  const [editing, setEditing] = useState(false);
  const [wantsText, setWantsText] = useState(request.wants.join(", "));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(body: object) {
    setError("");
    setBusy(true);
    try {
      const { request: updated } = await api<{ request: SwapRequest }>(`/requests/${request.id}`, {
        method: "PATCH",
        body,
      });
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (window.confirm(`Cancel your ${request.courseCode} request?`)) {
      update({ status: "cancelled" });
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <strong>{request.courseCode}</strong>
        <span className={`badge badge-${request.status}`}>{request.status}</span>
      </div>
      <p className="hint">{request.courseTitle}</p>
      <p>
        {KIND_LABELS[request.kind]}: you have <strong>{request.have}</strong>
        {!editing && (
          <>
            , you'd take <strong>{request.wants.join(", ")}</strong>
          </>
        )}
      </p>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ wants: parseSectionList(wantsText) });
          }}
        >
          <label>
            Sections you'd take
            <input value={wantsText} onChange={(e) => setWantsText(e.target.value)} autoFocus />
          </label>
          <div className="row">
            <button disabled={busy}>Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Back
            </button>
          </div>
        </form>
      )}

      {request.matchId && (
        <Link to={`/matches/${request.matchId}`} className="match-link">
          You have a match! View it →
        </Link>
      )}

      {error && <p className="error">{error}</p>}

      {request.status === "open" && !editing && (
        <div className="row">
          <button className="secondary" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="secondary danger" disabled={busy} onClick={cancel}>
            Cancel request
          </button>
        </div>
      )}
    </article>
  );
}
