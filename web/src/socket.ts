import { io, type Socket } from "socket.io-client";
import { API_URL } from "./api";

let socket: Socket | null = null;

// One live connection per tab, shared by every page. It logs in with the same session cookie
// as the REST API, which is why withCredentials is on.
export function getSocket(): Socket {
  socket ??= io(API_URL, { withCredentials: true });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
