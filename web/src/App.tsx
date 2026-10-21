import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router";
import { api, ApiError, type User } from "./api";
import { LoginForm } from "./LoginForm";
import { DisplayNameForm } from "./DisplayNameForm";
import { MyRequests } from "./MyRequests";
import { NewRequest } from "./NewRequest";
import { MatchPage } from "./MatchPage";
import { Account } from "./Account";
import { Rules } from "./Rules";
import { disconnectSocket, getSocket } from "./socket";

type Auth =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loggedOut" }
  | { status: "loggedIn"; user: User };

export function App() {
  const [auth, setAuth] = useState<Auth>({ status: "loading" });
  const [newMatchId, setNewMatchId] = useState<string | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const ready = auth.status === "loggedIn" && Boolean(auth.user.displayName);
  const dismissNewMatch = useCallback(() => setNewMatchId(null), []);

  // Once logged in, open the live connection: watch for new matches on any page, and for the
  // connection dropping (Wi-Fi, phone sleeping, server restarting).
  useEffect(() => {
    if (!ready) return;
    const socket = getSocket();
    const onNewMatch = (event: { matchId: string }) => setNewMatchId(event.matchId);
    const onConnect = () => setConnection("online");
    const onDisconnect = () => setConnection("offline");
    socket.on("match:new", onNewMatch);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    return () => {
      socket.off("match:new", onNewMatch);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
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

  function signedOut() {
    disconnectSocket();
    setConnection("connecting");
    setNewMatchId(null);
    setAuth({ status: "loggedOut" });
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    signedOut();
  }

  const loggedIn = (user: User) => setAuth({ status: "loggedIn", user });

  return (
    <BrowserRouter>
      <header>
        <h1>
          <Link to="/" className="brand">
            TMU Swap
          </Link>
        </h1>
        {ready && (
          <nav>
            <NavLink to="/" end>
              My requests
            </NavLink>
            <NavLink to="/new">New request</NavLink>
            <NavLink to="/account">Account</NavLink>
          </nav>
        )}
      </header>

      {ready && connection === "offline" && (
        <div className="banner warning" role="status">
          Reconnecting… Live updates are paused until you're back online.
        </div>
      )}
      {ready && newMatchId && <NewMatchBanner matchId={newMatchId} onDismiss={dismissNewMatch} />}

      <main className="wide">
        {auth.status === "loggedIn" && auth.user.displayName ? (
          <Routes>
            <Route path="/" element={<MyRequests />} />
            <Route path="/new" element={<NewRequest />} />
            <Route path="/matches/:id" element={<MatchPage user={auth.user} />} />
            <Route
              path="/account"
              element={<Account user={auth.user} onUpdated={loggedIn} onLogout={logout} onDeleted={signedOut} />}
            />
            <Route path="/rules" element={<Rules />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/rules" element={<Rules />} />
            <Route
              path="*"
              element={
                <>
                  {auth.status === "loading" && <p className="hint">Loading…</p>}
                  {auth.status === "error" && (
                    <>
                      <p className="error">{auth.message}</p>
                      <button onClick={retry}>Try again</button>
                    </>
                  )}
                  {auth.status === "loggedOut" && <LoginForm onLoggedIn={loggedIn} />}
                  {auth.status === "loggedIn" && <DisplayNameForm onSaved={loggedIn} />}
                </>
              }
            />
          </Routes>
        )}
      </main>

      <footer>
        <Link to="/rules">Rules</Link> · Not affiliated with TMU. We never ask for your TMU password.
      </footer>
    </BrowserRouter>
  );
}

// "You have a new swap match!", until you open that match (from here or anywhere else) or close it.
function NewMatchBanner({ matchId, onDismiss }: { matchId: string; onDismiss: () => void }) {
  const { pathname } = useLocation();
  const viewing = pathname === `/matches/${matchId}`;

  useEffect(() => {
    if (viewing) onDismiss();
  }, [viewing, onDismiss]);

  if (viewing) return null;
  return (
    <div className="banner" role="status">
      <span>
        You have a new swap match! <Link to={`/matches/${matchId}`}>View it</Link>
      </span>
      <button className="link dismiss" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

function NotFound() {
  return (
    <section>
      <h2>Page not found</h2>
      <p>
        That page doesn't exist. <Link to="/">Back to my requests</Link>
      </p>
    </section>
  );
}
