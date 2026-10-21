import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "./api";

type Props = {
  user: User;
  onUpdated: (user: User) => void;
  onLogout: () => void;
  onDeleted: () => void;
};

export function Account({ user, onUpdated, onLogout, onDeleted }: Props) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveName(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { user: updated } = await api<{ user: User }>("/auth/me", { method: "PATCH", body: { displayName } });
      onUpdated(updated);
      setMessage("Saved.");
    });
  }

  function deleteAccount() {
    const sure = window.confirm(
      "Delete your account? Your requests, matches and messages will be deleted. This can't be undone.",
    );
    if (!sure) return;
    run(async () => {
      await api("/auth/me", { method: "DELETE", body: { confirm: true } });
      onDeleted();
    });
  }

  return (
    <section>
      <h2>Account</h2>
      <p className="hint">Logged in as {user.email}. Other students only see your display name.</p>

      <form onSubmit={saveName}>
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} required />
        </label>
        <button disabled={busy}>Save</button>
      </form>
      {message && <p className="hint">{message}</p>}
      {error && <p className="error">{error}</p>}

      <button className="secondary" onClick={onLogout}>
        Log out
      </button>

      <h3>Delete account</h3>
      <p className="hint">Permanently deletes your account and everything in it. Any match you're in ends.</p>
      <button className="secondary danger" disabled={busy} onClick={deleteAccount}>
        Delete my account
      </button>
    </section>
  );
}
