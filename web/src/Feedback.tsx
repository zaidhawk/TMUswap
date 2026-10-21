import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { api, ApiError, SUPPORT_EMAIL } from "./api";

// Bug reports and ideas from beta testers. The footer link passes the page they came from, so
// the email says where the problem happened.
export function Feedback({ loggedIn }: { loggedIn: boolean }) {
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/feedback", { method: "POST", body: { message, page: from } });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loggedIn) {
    return (
      <section>
        <h2>Feedback</h2>
        <p>
          Log in to send feedback from here. Can't log in, or the code never arrived? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("TMU Swap login problem")}`}>{SUPPORT_EMAIL}</a> and tell us what
          happened.
        </p>
      </section>
    );
  }

  if (sent) {
    return (
      <section>
        <h2>Thanks!</h2>
        <p>We read every message. If you reported a bug, we'll try to fix it quickly.</p>
        <Link to={from ?? "/"}>Back to where you were</Link>
      </section>
    );
  }

  return (
    <section>
      <h2>Feedback</h2>
      <p className="hint">
        Something broken, confusing, or missing? If it's a bug, say what you clicked and what you expected to happen.
        We'll also see which page you came from and which browser you're using.
      </p>
      <form onSubmit={submit}>
        <label>
          Your message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} maxLength={2000} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy || message.trim().length < 10}>Send feedback</button>
      </form>
    </section>
  );
}
