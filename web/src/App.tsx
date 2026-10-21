import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from "react-router";
import { api, ApiError, type User } from "./api";
import { LoginForm } from "./LoginForm";
import { DisplayNameForm } from "./DisplayNameForm";
import { MyRequests } from "./MyRequests";
import { NewRequest } from "./NewRequest";
import { MatchPage } from "./MatchPage";
import { disconnectSocket, getSocket } from "./socket";

type Auth =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loggedOut" }
  | { status: "loggedIn"; user: User };

export function App() {
  const [auth, setAuth] = useState<Auth>({ status: "loading" });
  const [newMatchId, setNewMatchId] = useState<string | null>(null);
  const ready = auth.status === "loggedIn" && Boolean(auth.user.displayName);

  // Once logged in, open the live connection and watch for new matches on any page.
  useEffect(() => {
    if (!ready) return;
    const socket = getSocket();
    const onNewMatch = (event: { matchId: string }) => setNewMatchId(event.matchId);
    socket.on("match:new", onNewMatch);
    return () => {
      socket.off("match:new", onNewMatch);
    };
  }, [ready]);

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
    disconnectSocket();
    setAuth({ status: "loggedOut" });
  }

  if (auth.status === "loggedIn" && auth.user.displayName) {
    return (
      <BrowserRouter>
        <header>
          <h1>TMU Swap</h1>
          <nav>
            <NavLink to="/" end>
              My requests
            </NavLink>
            <NavLink to="/new">New request</NavLink>
            <span className="hint">{auth.user.displayName}</span>
            <button className="link" onClick={logout}>
              Log out
            </button>
          </nav>
        </header>
        {newMatchId && (
          <div className="banner">
            You have a new swap match!{" "}
            <Link to={`/matches/${newMatchId}`} onClick={() => setNewMatchId(null)}>
              View it
            </Link>
          </div>
        )}
        <main className="wide">
          <Routes>
            <Route path="/" element={<MyRequests />} />
            <Route path="/new" element={<NewRequest />} />
            <Route path="/matches/:id" element={<MatchPage user={auth.user} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    );
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
      {auth.status === "loggedIn" && (
        <DisplayNameForm onSaved={(user) => setAuth({ status: "loggedIn", user })} />
      )}
    </main>
  );
}
