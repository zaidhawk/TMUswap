import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "./api";

type Props = { onSaved: (user: User) => void };

// Shown once, right after a new user's first login.
export function DisplayNameForm({ onSaved }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>("/auth/me", {
        method: "PATCH",
        body: { displayName },
      });
      onSaved(user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <h2>Pick a display name</h2>
      <p>This is what other students see when you swap. They never see your email.</p>
      <label>
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={30}
          required
          autoFocus
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
    </form>
  );
}
