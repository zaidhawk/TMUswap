import { useEffect, useState } from "react";
import type { Match, SwapStep } from "./api";

type Props = {
  match: Match;
  // How far the server's clock is ahead of this browser's, in ms.
  clockOffset: number;
  busy: boolean;
  onPress: (press: boolean) => void;
  onChooseFirst: (memberId: string) => void;
  onOutcome: (outcome: "completed" | "failed") => void;
};

function describeStep(step: SwapStep): string {
  const who = step.isMe ? "You" : step.displayName;
  if (step.action === "drop") return `${who} drop${step.isMe ? "" : "s"} section ${step.from}.`;
  if (step.action === "swap") {
    return `${who} use${step.isMe ? "" : "s"} Swap to move from ${step.from} into ${step.to}.`;
  }
  return `${who} add${step.isMe ? "" : "s"} section ${step.to}.`;
}

export function Countdown({ match, clockOffset, busy, onPress, onChooseFirst, onOutcome }: Props) {
  const me = match.members.find((m) => m.isMe)!;
  const startsAt = match.countdownStartsAt ? new Date(match.countdownStartsAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  // Tick 10 times a second while a countdown is running, using the server's clock.
  useEffect(() => {
    if (startsAt === null) return;
    const timer = setInterval(() => setNow(Date.now() + clockOffset), 100);
    return () => clearInterval(timer);
  }, [startsAt, clockOffset]);

  // Capped at 10: our estimate of the server's clock can run a little behind (by the network
  // delay), which would otherwise briefly show 11.
  const secondsLeft = startsAt === null ? null : Math.min(10, Math.ceil((startsAt - now) / 1000));
  const closed = match.status === "completed" || match.status === "failed";

  return (
    <div className="card">
      <h3>The swap, step by step</h3>
      <ol className="steps">
        {match.steps.map((step, i) => (
          <li key={i} className={step.isMe ? "my-step" : undefined}>
            {describeStep(step)}
          </li>
        ))}
      </ol>
      <p className="hint">
        Only the first person is ever without a seat, and only for a few seconds. Make sure none of these sections has a
        wait list.
      </p>

      {match.status === "accepted" && (
        <>
          <fieldset>
            <legend>Who goes first?</legend>
            <div className="row">
              {match.members.map((m) => (
                <label key={m.memberId} className="choice">
                  <input
                    type="radio"
                    name="first"
                    checked={m.goesFirst}
                    disabled={busy}
                    onChange={() => onChooseFirst(m.memberId)}
                  />
                  {m.isMe ? "Me" : m.displayName}
                </label>
              ))}
            </div>
            <span className="hint">Changing this resets everyone's Start presses.</span>
          </fieldset>

          <p>
            The countdown starts when everyone has pressed Start:{" "}
            {match.members.map((m) => `${m.isMe ? "you" : m.displayName} ${m.pressedStart ? "✓" : "…"}`).join(", ")}
          </p>
          {match.countdownBlockedReason ? (
            <p className="error">{match.countdownBlockedReason}</p>
          ) : (
            <button disabled={busy} onClick={() => onPress(!me.pressedStart)} className={me.pressedStart ? "secondary" : ""}>
              {me.pressedStart ? "Cancel my Start" : "Start countdown"}
            </button>
          )}
        </>
      )}

      {match.status === "counting_down" && secondsLeft !== null && (
        <div className="countdown">
          {secondsLeft > 0 ? (
            <>
              <span className="countdown-number">{secondsLeft}</span>
              <span>Get MyServiceHub ready…</span>
            </>
          ) : (
            <span className="countdown-number">Go! Do your step now.</span>
          )}
        </div>
      )}

      {(match.status === "accepted" || match.status === "counting_down") && (
        <div className="row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => window.confirm("Mark the swap as done for everyone?") && onOutcome("completed")}
          >
            It worked
          </button>
          <button
            className="secondary danger"
            disabled={busy}
            onClick={() => window.confirm("Mark the swap as failed? Everyone's requests will be closed.") && onOutcome("failed")}
          >
            Something went wrong
          </button>
        </div>
      )}

      {closed && (
        <p>{match.status === "completed" ? "Swap completed. Nice work!" : "This swap didn't work out. You can post a new request any time."}</p>
      )}
    </div>
  );
}
