import { useState, type FormEvent } from "react";
import { api, ApiError, type MatchMember } from "./api";

type Props = { matchId: string; others: MatchMember[] };

// "Report a problem" under every match: pick who (in a 3-way swap) and say what happened.
export function ReportForm({ matchId, others }: Props) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(others[0]?.memberId ?? "");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/reports", { method: "POST", body: { matchId, memberId, reason } });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (others.length === 0) return null;
  if (sent) return <p className="hint">Thanks. We've received your report and will look into it.</p>;
  if (!open) {
    return (
      <button className="link danger report-link" onClick={() => setOpen(true)}>
        Report a problem with someone in this match
      </button>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Report a problem</h3>
      {others.length > 1 && (
        <label>
          Who?
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {others.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        What happened{others.length === 1 ? ` with ${others[0]!.displayName}` : ""}?
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000} required />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={busy || reason.trim().length < 10}>Send report</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
