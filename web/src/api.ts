const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type User = { id: string; email: string; displayName: string | null };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Calls the API with the session cookie attached, and turns error responses into ApiError
// with the server's message, so screens can show it directly.
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method: init.method ?? "GET",
      credentials: "include", // send and receive the session cookie
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error ?? "Something went wrong. Try again.", res.status);
  }
  return data as T;
}
