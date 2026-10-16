import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, type SwapRequest } from "./api";
import { KIND_LABELS, parseSectionList } from "./sections";

export function MyRequests() {
  const [requests, setRequests] = useState<SwapRequest[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ requests: SwapRequest[] }>("/requests/mine")
      .then(({ requests }) => setRequests(requests))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your requests."));
  }, []);

  function replace(updated: SwapRequest) {
    setRequests((current) => current?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
  }

  if (error) return <p className="error">{error}</p>;
  if (!requests) return <p className="hint">Loading…</p>;

  const open = requests.filter((r) => r.status === "open" || r.status === "matched");
  const past = requests.filter((r) => r.status !== "open" && r.status !== "matched");

  return (
    <section>
      <h2>My requests</h2>
      {open.length === 0 && (
        <p>
          You have no open requests. <Link to="/new">Post one</Link> to get matched.
        </p>
      )}
      {open.map((r) => (
        <RequestCard key={r.id} request={r} onChange={replace} />
      ))}
      {past.length > 0 && (
        <>
          <h3>Past requests</h3>
          {past.map((r) => (
            <RequestCard key={r.id} request={r} onChange={replace} />
          ))}
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
