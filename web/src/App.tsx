import { useEffect, useState } from "react";
import { api, ApiError, type User } from "./api";
import { LoginForm } from "./LoginForm";
import { DisplayNameForm } from "./DisplayNameForm";

type Auth =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loggedOut" }
  | { status: "loggedIn"; user: User };

export function App() {
  const [auth, setAuth] = useState<Auth>({ status: "loading" });

  // Ask the API who we are. A 401 just means "not logged in".
  function loadSession() {
    api<{ user: User }>("/auth/me")
      .then(({ user }) => setAuth({ status: "loggedIn", user }))
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          setAuth({ status: "loggedOut" });
        } else {
          setAuth({ status: "error", message: e instanceof Error ? e.message : String(e) });
        }
      });
  }

  // Runs once on page load. State already starts as "loading".
  useEffect(loadSession, []);

  function retry() {
    setAuth({ status: "loading" });
    loadSession();
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setAuth({ status: "loggedOut" });
  }

  return (
    <main>
      <h1>TMU Swap</h1>
      {auth.status === "loading" && <p className="hint">Loading…</p>}
      {auth.status === "error" && (
        <>
          <p className="error">{auth.message}</p>
          <button onClick={retry}>Try again</button>
        </>
      )}
      {auth.status === "loggedOut" && (
        <LoginForm onLoggedIn={(user) => setAuth({ status: "loggedIn", user })} />
      )}
      {auth.status === "loggedIn" && !auth.user.displayName && (
        <DisplayNameForm onSaved={(user) => setAuth({ status: "loggedIn", user })} />
      )}
      {auth.status === "loggedIn" && auth.user.displayName && (
        <section>
          <h2>Hi, {auth.user.displayName}!</h2>
          <p>You're logged in as {auth.user.email}. Swap requests are coming soon.</p>
          <button onClick={logout}>Log out</button>
        </section>
      )}
    </main>
  );
}
