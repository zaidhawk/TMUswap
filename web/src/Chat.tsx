import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type ChatMessage } from "./api";
import { getSocket } from "./socket";

const PAGE_SIZE = 50;
const TYPING_SHOWN_MS = 3000;

type Props = { matchId: string; myUserId: string; canSend: boolean };

export function Chat({ matchId, myUserId, canSend }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Load the latest messages, join the live room, and re-join after any reconnect
  // (a reconnected socket starts with no rooms).
  useEffect(() => {
    const socket = getSocket();
    let typingTimer: ReturnType<typeof setTimeout> | undefined;

    function sync() {
      socket.emit("match:join", matchId, () => {});
      api<{ messages: ChatMessage[] }>(`/matches/${matchId}/messages`)
        .then(({ messages }) => {
          setMessages(messages);
          setHasOlder(messages.length === PAGE_SIZE);
        })
        .catch(() => setError("Couldn't load the chat."));
    }

    function onMessage(message: ChatMessage) {
      if (message.matchId !== matchId) return;
      // Our own message may already be on screen from the send acknowledgement.
      setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
      setTyping(null);
    }

    function onTyping(event: { matchId: string; displayName: string }) {
      if (event.matchId !== matchId) return;
      setTyping(event.displayName);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(null), TYPING_SHOWN_MS);
    }

    sync();
    socket.on("connect", sync);
    socket.on("message:new", onMessage);
    socket.on("typing", onTyping);
    return () => {
      clearTimeout(typingTimer);
      socket.off("connect", sync);
      socket.off("message:new", onMessage);
      socket.off("typing", onTyping);
    };
  }, [matchId]);

  // Keep the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    try {
      const { messages: older } = await api<{ messages: ChatMessage[] }>(
        `/matches/${matchId}/messages?before=${oldest.id}`,
      );
      setMessages((current) => [...older, ...current]);
      setHasOlder(older.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load older messages.");
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setError("");
    setSending(true);
    try {
      const ack = await getSocket()
        .timeout(5000)
        .emitWithAck("message:send", { matchId, body: draft });
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      setMessages((current) => (current.some((m) => m.id === ack.message.id) ? current : [...current, ack.message]));
      setDraft("");
    } catch {
      setError("Couldn't send your message. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    getSocket().emit("typing", { matchId });
  }

  return (
    <div className="chat">
      <h3>Chat</h3>
      <div className="chat-log">
        {hasOlder && (
          <button className="link" onClick={loadOlder}>
            Load earlier messages
          </button>
        )}
        {messages.length === 0 && <p className="hint">No messages yet. Say hi and agree on a time.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.senderId === myUserId ? "bubble mine" : "bubble"}>
            {m.senderId !== myUserId && <span className="hint">{m.senderName}</span>}
            {/* React renders this as plain text, so HTML in a message is shown, never run. */}
            <p>{m.body}</p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {typing && <p className="hint">{typing} is typing…</p>}
      {canSend && (
        <form className="chat-form" onSubmit={send}>
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            maxLength={1000}
            placeholder="Message"
            aria-label="Message"
          />
          <button disabled={sending || !draft.trim()}>Send</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <p className="hint">Never share your TMU password. Report anyone who asks for money.</p>
    </div>
  );
}
