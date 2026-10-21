export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type User = { id: string; email: string; displayName: string | null; isAdmin: boolean };

export type Course = { id: string; code: string; title: string };

export type SectionKind = "lecture" | "lab" | "tutorial";

export type Section = { id: string; kind: SectionKind; label: string };

export type SwapRequest = {
  id: string;
  status: "open" | "matched" | "completed" | "cancelled" | "expired";
  createdAt: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  kind: SectionKind;
  have: string;
  wants: string[];
  matchId: string | null;
};

// Someone's open request as it appears on the Board. Who posted it stays hidden until a match.
export type BoardRequest = {
  id: string;
  createdAt: string;
  courseCode: string;
  courseTitle: string;
  kind: SectionKind;
  have: string;
  wants: string[];
  isMine: boolean;
  myOffer: "pending" | "declined" | null;
};

export type ReceivedOffer = {
  id: string;
  requestId: string;
  courseCode: string;
  kind: SectionKind;
  yourSection: string;
  theirSection: string;
  createdAt: string;
};

export type SentOffer = {
  id: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  courseCode: string;
  kind: SectionKind;
  yourSection: string;
  theirSection: string;
  requestOpen: boolean;
  createdAt: string;
};

export type MatchMember = {
  memberId: string;
  displayName: string;
  gives: string;
  gets: string;
  accepted: boolean;
  pressedStart: boolean;
  goesFirst: boolean;
  isMe: boolean;
};

export type SwapStep = {
  memberId: string;
  displayName: string;
  isMe: boolean;
  action: "drop" | "swap" | "add";
  from?: string;
  to?: string;
};

export type Match = {
  id: string;
  size: 2 | 3;
  status: "proposed" | "accepted" | "counting_down" | "completed" | "failed" | "expired";
  expiresAt: string;
  courseCode: string;
  courseTitle: string;
  kind: SectionKind;
  members: MatchMember[];
  steps: SwapStep[];
  countdownStartsAt: string | null;
  countdownBlockedReason: string | null;
  serverTime: string;
};

export type ChatMessage = {
  id: string;
  matchId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

export type Stats = {
  totals: {
    signUps: number;
    accounts: number;
    requestsPosted: number;
    openRequests: number;
    offersSent: number;
    offersAccepted: number;
    matches: number;
    threeWayMatches: number;
    acceptedMatches: number;
    completedSwaps: number;
    failedSwaps: number;
    studentsSwapped: number;
  };
  days: { date: string; signUps: number; requestsPosted: number; matches: number; completedSwaps: number }[];
};

// Where students report a course that isn't listed yet.
export const SUPPORT_EMAIL = "zaidhaque63@gmail.com";

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
    res = await fetch(`${API_URL}${path}`, {
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
