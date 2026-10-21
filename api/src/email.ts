import { config } from "./config.js";

type Email = { to: string; subject: string; text: string };

// Outside production, emails are kept here instead of sent, so tests can read them.
const devOutbox: Email[] = [];
const FOOTER = "TMU Swap is not affiliated with TMU. We never ask for your TMU password.";

async function sendEmail(email: Email): Promise<void> {
  if (!config.isProduction) {
    devOutbox.push(email);
    if (process.env.NODE_ENV !== "test") {
      console.log(`[email] To ${email.to}: ${email.subject}`);
    }
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  await sendWithResend({ apiKey, from: config.emailFrom, ...email });
}

export async function sendLoginCode(email: string, code: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: `${code} is your TMU Swap code`,
    text: [
      `Your TMU Swap login code is ${code}.`,
      "",
      "It expires in 10 minutes. If you didn't ask for it, you can ignore this email.",
      "",
      FOOTER,
    ].join("\n"),
  });
}

export async function sendMatchFound(email: string, courseCode: string, matchUrl: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: `You have a swap match for ${courseCode}`,
    text: [
      `Good news: we found a swap for your ${courseCode} request.`,
      "",
      `Open it and accept within 24 hours, or the match expires: ${matchUrl}`,
      "",
      FOOTER,
    ].join("\n"),
  });
}

// The newest login code sent to an address (dev and tests only).
export function lastCodeSentTo(email: string): string | undefined {
  const last = devOutbox.findLast((e) => e.to === email && e.subject.endsWith("is your TMU Swap code"));
  return last?.subject.slice(0, 6);
}

// Every email sent to an address so far (dev and tests only).
export function emailsSentTo(email: string): Email[] {
  return devOutbox.filter((e) => e.to === email);
}

type ResendOptions = Email & { apiKey: string; from: string };

// Calls Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// fetchFn is swappable so tests can check the request without sending a real email.
export async function sendWithResend(
  { apiKey, from, to, subject, text }: ResendOptions,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
  }
}
