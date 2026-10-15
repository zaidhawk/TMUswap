import { useEffect, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

type ApiStatus = "checking" | "ok" | "down";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch(`${apiUrl}/health`)
      .then((res) => res.json())
      .then((body) => setApiStatus(body.ok ? "ok" : "down"))
      .catch(() => setApiStatus("down"));
  }, []);

  return (
    <main>
      <h1>TMU Swap</h1>
      <p>Hello! Section swaps for TMU students are coming soon.</p>
      <p>API: {apiStatus}</p>
    </main>
  );
}
