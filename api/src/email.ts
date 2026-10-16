import { config } from "./config.js";

// Outside production, codes are kept here instead of emailed, so tests can read them.
const devOutbox = new Map<string, string>();

export async function sendLoginCode(email: string, code: string): Promise<void> {
  if (!config.isProduction) {
    devOutbox.set(email, code);
    if (process.env.NODE_ENV !== "test") {
      console.log(`[email] Login code for ${email}: ${code}`);
    }
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  await sendWithResend({ apiKey, from: config.emailFrom, to: email, code });
}

export function lastCodeSentTo(email: string): string | undefined {
  return devOutbox.get(email);
}

type ResendOptions = { apiKey: string; from: string; to: string; code: string };

// Calls Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// fetchFn is swappable so tests can check the request without sending a real email.
export async function sendWithResend(
  { apiKey, from, to, code }: ResendOptions,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: `${code} is your TMU Swap code`,
      text: [
        `Your TMU Swap login code is ${code}.`,
        "",
        "It expires in 10 minutes. If you didn't ask for it, you can ignore this email.",
        "",
        "TMU Swap is not affiliated with TMU. We never ask for your TMU password.",
      ].join("\n"),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
  }
}
