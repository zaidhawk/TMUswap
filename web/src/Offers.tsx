import { useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type ReceivedOffer, type SentOffer } from "./api";
import { KIND_LABELS } from "./sections";

// Offers other students made on your requests from the Board. Accepting matches you right away.
export function ReceivedOffers({ offers, onChange }: { offers: ReceivedOffer[]; onChange: () => void }) {
  if (offers.length === 0) return null;
  return (
    <>
      <h3>Offers for you</h3>
      {offers.map((o) => (
        <ReceivedOfferCard key={o.id} offer={o} onChange={onChange} />
      ))}
    </>
  );
}

function ReceivedOfferCard({ offer: o, onChange }: { offer: ReceivedOffer; onChange: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function answer(action: "accept" | "decline") {
    setError("");
    setBusy(true);
    try {
      const result = await api<{ matchId?: string }>(`/offers/${o.id}/${action}`, { method: "POST" });
      if (result.matchId) navigate(`/matches/${result.matchId}`);
      else onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <strong>{o.courseCode}</strong>
        <span className="badge badge-open">offer</span>
      </div>
      <p>
        A student offers {KIND_LABELS[o.kind].toLowerCase()} <strong>{o.theirSection}</strong> for your{" "}
        <strong>{o.yourSection}</strong>.
      </p>
      <p className="hint">Accept and you're matched straight away, with the chat open. Declining keeps your request open.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={busy} onClick={() => answer("accept")}>
          Accept
        </button>
        <button className="secondary" disabled={busy} onClick={() => answer("decline")}>
          Decline
        </button>
      </div>
    </article>
  );
}

const STATUS_TEXT: Record<SentOffer["status"], string> = {
  pending: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

// Offers you made from the Board, so you know where each one stands.
export function SentOffers({ offers, onChange }: { offers: SentOffer[]; onChange: () => void }) {
  const [error, setError] = useState("");

  async function withdraw(id: string) {
    setError("");
    try {
      await api(`/offers/${id}/withdraw`, { method: "POST" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    }
    onChange();
  }

  if (offers.length === 0) return null;
  return (
    <>
      <h3>Offers you've sent</h3>
      {error && <p className="error">{error}</p>}
      {offers.map((o) => {
        const waiting = o.status === "pending" && o.requestOpen;
        return (
          <article key={o.id} className="card">
            <div className="card-head">
              <strong>{o.courseCode}</strong>
              <span className="badge">
                {o.status === "pending" && !o.requestOpen ? "No longer available" : STATUS_TEXT[o.status]}
              </span>
            </div>
            <p>
              Your {KIND_LABELS[o.kind].toLowerCase()} <strong>{o.yourSection}</strong> for their{" "}
              <strong>{o.theirSection}</strong>
            </p>
            {waiting && (
              <button className="secondary" onClick={() => withdraw(o.id)}>
                Withdraw offer
              </button>
            )}
          </article>
        );
      })}
    </>
  );
}
