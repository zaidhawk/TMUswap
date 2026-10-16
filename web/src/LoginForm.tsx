import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "./api";

type Props = { onLoggedIn: (user: User) => void };

// Two steps: enter your TMU email, then the 6-digit code we emailed.
export function LoginForm({ onLoggedIn }: Props) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function requestCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api("/auth/request-code", { method: "POST", body: { email } });
      setCode("");
      setStep("code");
    });
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { user } = await api<{ user: User }>("/auth/verify", {
        method: "POST",
        body: { email, code },
      });
      onLoggedIn(user);
    });
  }

  if (step === "email") {
    return (
      <form onSubmit={requestCode}>
        <h2>Log in</h2>
        <label>
          TMU email
          <input
            type="email"
            autoComplete="email"
            placeholder="you@torontomu.ca"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
        <p className="hint">We never ask for your TMU password.</p>
      </form>
    );
  }

  return (
    <form onSubmit={verify}>
      <h2>Check your email</h2>
      <p>
        We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
      </p>
      <label>
        Code
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
          autoFocus
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Log in"}</button>
      <div className="links">
        <button type="button" className="link" disabled={busy} onClick={requestCode}>
          Send a new code
        </button>
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={() => {
            setError("");
            setStep("email");
          }}
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
