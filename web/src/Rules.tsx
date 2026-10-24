import { Link } from "react-router";
import { SUPPORT_EMAIL } from "./api";

export function Rules() {
  return (
    <section className="rules">
      <h2>Rules</h2>
      <p>TMU Swap connects students who want to trade sections of the same course. Keep it fair and safe:</p>

      <h3>Swaps are free</h3>
      <p>
        Every swap is one seat for one seat. Offering or asking for money, gifts or favours gets your account banned.
        Selling seats also breaks TMU's rules.
      </p>

      <h3>No wait-listed sections</h3>
      <p>
        When a seat opens in a section with a wait list, TMU gives it to the first person on that list, not to your swap
        partner. Only post sections without a wait list.
      </p>

      <h3>You make the change yourself</h3>
      <p>
        TMU Swap never touches MyServiceHub and never asks for your TMU password. Each person makes their own change in
        MyServiceHub, at the same moment, using the countdown. MyServiceHub is down every night from 12:00 to 1:15 am, so
        countdowns are paused from 11:45 pm to 1:15 am.
      </p>

      <h3>Be reliable</h3>
      <p>
        Accept a match only if you'll follow through. If your plans change, decline or cancel so others aren't left
        waiting.
      </p>

      <h3>Report problems</h3>
      <p>
        Every match has a Report button. We review every report, and we're notified when a chat mentions money. You can
        also email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h3>Your privacy</h3>
      <p>
        We store your TMU email, display name, course choices, and what you send through the site: chat messages,
        reports and feedback. Other students only ever see your display name, never your email: on your open requests on
        the Board, and in your matches. Chats are deleted 30 days after a match ends, and you can delete your account and
        everything in it at any time from the <Link to="/account">Account</Link> page.
      </p>

      <p className="hint">TMU Swap is a student project and is not affiliated with Toronto Metropolitan University.</p>
    </section>
  );
}
